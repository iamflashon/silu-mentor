import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents, examQuestions } from "../../../../db/schema";
import { requireMedtechAdmin } from "../../../../lib/member-auth";
import { contentTypeForDocument, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../../lib/document-processing";
import { openAIJson } from "../../../../lib/openai";
import { DELETE as deleteDocuments, GET as getDocuments, PATCH as patchDocument, POST as postDocument } from "../../documents/route";

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url); url.searchParams.set("category", "medtech");
  return getDocuments(new Request(url, { headers: request.headers }));
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
    const db = await getDb();
    const [current] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.examCategory, "medtech"))).limit(1);
    if (!current) return Response.json({ error: "找不到醫檢師文件" }, { status: 404 });
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET) return Response.json({ error: "文件儲存空間尚未就緒" }, { status: 503 });
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
    const newKey = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    await env.BUCKET.put(newKey, file.stream(), { httpMetadata: { contentType: contentTypeForDocument(file.name, file.type) }, customMetadata: { subject: current.subject, documentType: current.documentType, originalName: file.name } });
    try {
      const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
      if (current.openaiFileId && setting?.value) {
        await openAIJson(`/vector_stores/${setting.value}/files/${current.openaiFileId}`, { method: "DELETE" }).catch(() => undefined);
        await openAIJson(`/files/${current.openaiFileId}`, { method: "DELETE" }).catch(() => undefined);
      }
      await db.delete(examQuestions).where(and(eq(examQuestions.examCategory, "medtech"), eq(examQuestions.sourceUrl, `document:${id}`)));
      await db.update(documents).set({ storageKey: newKey, fileName: file.name, contentType: contentTypeForDocument(file.name, file.type), sizeBytes: file.size, status: "uploaded", processingStage: "queued", processingMessage: "原始文件已更換，等待重新擷取與完整拆題", openaiFileId: null, indexError: null, fileSha256: null, pageCount: null, extractedChars: 0, chapterCount: 0, questionCount: 0, tagsJson: "[]", processingResultJson: "{}", fullTextIndexed: false, vectorIndexed: false, processedAt: null }).where(eq(documents.id, id));
      await env.BUCKET.delete(current.storageKey).catch(() => undefined);
      return Response.json({ replaced: true, id, name: file.name });
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
  const body = await request.json() as { id?: number; homepageSearchEnabled?: boolean; subject?: string };
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
