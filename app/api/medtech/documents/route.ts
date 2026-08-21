import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import { requireMedtechAdmin } from "../../../../lib/member-auth";
import { contentTypeForDocument, documentExtension, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../../lib/document-processing";
import { DELETE as deleteDocuments, GET as getDocuments, PATCH as patchDocument, POST as postDocument } from "../../documents/route";

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const requestedId = Number(url.searchParams.get("id"));
  if (!Number.isInteger(requestedId) || requestedId < 1) {
    url.searchParams.set("category", "medtech");
    return getDocuments(new Request(url, { headers: request.headers }));
  }

  // The workspace needs one document and its source variants only. Avoid the
  // company dashboard query here: it also touches optional analytics/index
  // tables, so one pending Dev migration could hide an otherwise valid PDF.
  try {
    const db = await getDb("primary");
    const [row] = await db.select({
      id: documents.id,
      fileName: documents.fileName,
      subject: documents.subject,
      documentType: documents.documentType,
      processingStage: documents.processingStage,
      questionCount: documents.questionCount,
      processingResultJson: documents.processingResultJson,
    }).from(documents).where(and(eq(documents.id, requestedId), eq(documents.examCategory, "medtech"))).limit(1);
    if (!row) return Response.json({ documents: [] }, { headers: { "Cache-Control": "no-store" } });

    let result: Record<string, unknown> = {};
    try { result = JSON.parse(row.processingResultJson) as Record<string, unknown>; } catch { result = {}; }
    const sourceVariants = Array.isArray(result.sourceVariants)
      ? result.sourceVariants
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).storageKey === "string"))
          .map((item) => ({
            kind: typeof item.kind === "string" ? item.kind : "other",
            storageKey: String(item.storageKey),
            fileName: typeof item.fileName === "string" ? item.fileName : "原稿版本",
            contentType: typeof item.contentType === "string" ? item.contentType : "application/octet-stream",
            sizeBytes: Number(item.sizeBytes ?? 0),
          }))
      : [];
    return Response.json({ documents: [{
      id: row.id,
      name: row.fileName,
      subject: row.subject,
      type: row.documentType,
      processingStage: row.processingStage,
      questionCount: Number(row.questionCount ?? 0),
      indexedQuestionCount: Number(row.questionCount ?? 0),
      sourceVariants,
    }] }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : "未知資料庫錯誤";
    console.error("medtech document workspace lookup failed", { requestedId, detail });
    return Response.json({ error: `原稿文件讀取失敗：${detail}` }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData(); form.set("examCategory", "medtech");
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return postDocument(new Request(request.url, { method: "POST", headers, body: form }));
}

export async function PUT(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  try {
    const form = await request.formData();
    const id = Number(form.get("id"));
    const file = form.get("file");
    if (!Number.isInteger(id) || id < 1 || !(file instanceof File) || !isSupportedDocument(file.name, file.type)) return Response.json({ error: "請選擇正確的 PDF、HTML 或 Word 原稿" }, { status: 400 });
    if (file.size > MAX_DOCUMENT_BYTES) return Response.json({ error: "文件不可超過 55MB" }, { status: 413 });
    const db = await getDb("primary");
    const [current] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.examCategory, "medtech"))).limit(1);
    const linkedQuestions = current ? [] : await db.select({ id: examQuestions.id, subject: examQuestions.subject }).from(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, `document:${id}`)));
    if (!current && !linkedQuestions.length) return Response.json({ error: "找不到醫檢師文件或其既有題目" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "文件儲存空間尚未就緒" }, { status: 503 });
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
    const newKey = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const fallbackSubject = linkedQuestions[0]?.subject || "未分類";
    await env.BUCKET.put(newKey, file.stream(), { httpMetadata: { contentType: contentTypeForDocument(file.name, file.type) }, customMetadata: { subject: current?.subject || fallbackSubject, documentType: current?.documentType || "題庫", bookTitle: current?.bookTitle || file.name, originalName: file.name } });
    try {
      if (!current) {
        await db.insert(documents).values({ id, storageKey: newKey, fileName: file.name, contentType: contentTypeForDocument(file.name, file.type), sizeBytes: file.size, examCategory: "medtech", bookTitle: file.name.replace(/\.[^.]+$/u, ""), subject: fallbackSubject, documentType: "題庫", status: "completed", processingStage: "completed", processingMessage: "已由既有題目補回 PDF 原稿文件紀錄", questionCount: linkedQuestions.length, processingResultJson: JSON.stringify({ sourceVariants: [] }) });
        const [verified] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName }).from(documents).where(eq(documents.id, id)).limit(1);
        if (!verified || verified.storageKey !== newKey || verified.fileName !== file.name) throw new Error("PDF 已上傳，但文件紀錄寫入後無法讀回");
        return Response.json({ replaced: true, repaired: true, persisted: true, variant: documentExtension(file.name) ?? "other", id, name: file.name });
      }
      let parsedResult: Record<string, unknown> = {};
      try { parsedResult = JSON.parse(current.processingResultJson) as Record<string, unknown>; } catch { parsedResult = {}; }
      const variants = Array.isArray(parsedResult.sourceVariants)
        ? parsedResult.sourceVariants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).storageKey === "string"))
        : [];
      const currentKind = documentExtension(current.fileName);
      const nextKind = documentExtension(file.name);
      const variantKind = nextKind === "pdf" ? "pdf" : nextKind === "html" ? "html" : nextKind ?? "other";
      const nextVariants = variants.filter((item) => item.kind !== variantKind);
      // Keep the existing primary object instead of deleting it. A PDF and an
      // HTML rendering can therefore coexist and be switched in the workspace.
      // Re-uploading the same kind is a replacement, not another source
      // variant. This prevents repeated PDF uploads from accumulating duplicate
      // originals while still allowing one PDF and one HTML source to coexist.
      if (currentKind !== variantKind) {
        nextVariants.push({ kind: currentKind === "pdf" ? "pdf" : currentKind === "html" ? "html" : currentKind ?? "other", storageKey: current.storageKey, fileName: current.fileName, contentType: current.contentType, sizeBytes: current.sizeBytes, createdAt: new Date().toISOString() });
      }
      await db.update(documents).set({ storageKey: newKey, fileName: file.name, contentType: contentTypeForDocument(file.name, file.type), sizeBytes: file.size, processingMessage: `已新增${variantKind === "html" ? " HTML" : variantKind === "pdf" ? " PDF" : "原稿版本"}；既有題目、解析與順序均保留，未重新拆題`, processingResultJson: JSON.stringify({ ...parsedResult, sourceVariants: nextVariants }), indexError: null }).where(eq(documents.id, id));
      const [verified] = await db.select({ storageKey: documents.storageKey, fileName: documents.fileName }).from(documents).where(eq(documents.id, id)).limit(1);
      if (!verified || verified.storageKey !== newKey || verified.fileName !== file.name) throw new Error("PDF 已上傳，但文件紀錄更新後無法讀回");
      if (currentKind === variantKind && current.storageKey !== newKey) {
        await env.BUCKET.delete(current.storageKey).catch(() => undefined);
      }
      return Response.json({ replaced: true, persisted: true, variant: variantKind, id, name: file.name, variants: nextVariants.map((item) => ({ kind: item.kind, fileName: item.fileName })) });
    } catch (error) {
      await env.BUCKET.delete(newKey).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 240) : "更換文件失敗" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean; subject?: string; bookTitle?: string };
  const db = await getDb();
  const [row] = await db.select().from(documents).where(and(eq(documents.id, Number(body.id)), eq(documents.examCategory, "medtech"))).limit(1);
  if (!row) return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
  if (typeof body.subject === "string") {
    const subject = body.subject.replace(/\s+/gu, " ").trim().slice(0, 80);
    if (!subject) return Response.json({ error: "請輸入科目名稱" }, { status: 400 });
    await db.update(documents).set({ subject }).where(eq(documents.id, row.id));
    await db.update(examQuestions).set({ subject }).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, `document:${row.id}`)));
    return Response.json({ id: row.id, subject, questionsUpdated: row.questionCount });
  }
  if (typeof body.bookTitle === "string") {
    const bookTitle = body.bookTitle.replace(/\s+/gu, " ").trim().slice(0, 200);
    if (!bookTitle) return Response.json({ error: "請輸入書籍名稱" }, { status: 400 });
    await db.update(documents).set({ bookTitle }).where(eq(documents.id, row.id));
    await db.update(examQuestions).set({ answerSource: bookTitle }).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, `document:${row.id}`)));
    return Response.json({ id: row.id, bookTitle });
  }
  return patchDocument(new Request(request.url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

export async function DELETE(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { ids?: unknown[] };
  const ids = (body.ids ?? []).map(Number).filter(Number.isInteger);
  const db = await getDb();
  const allowed = ids.length ? await db.select({ id: documents.id }).from(documents).where(and(eq(documents.examCategory, "medtech"), inArray(documents.id, ids))) : [];
  return deleteDocuments(new Request(request.url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: allowed.map(row => row.id) }) }));
}
