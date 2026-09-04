import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documents, examQuestions } from "../../../../db/schema";
import {
  canAccessMedtechDocument,
  isLimitedMedtechDocumentEditor,
  requireMedtechAdmin,
  requireMedtechQuestionEditor,
} from "../../../../lib/member-auth";
import {
  contentTypeForDocument,
  documentExtension,
  isSupportedDocument,
  MAX_DOCUMENT_BYTES,
} from "../../../../lib/document-processing";
import {
  DELETE as deleteDocuments,
  GET as getDocuments,
  PATCH as patchDocument,
  POST as postDocument,
} from "../../documents/route";

function jsonObject(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalized(value: string | null | undefined) {
  return String(value || "")
    .replace(/<[^>]+>/gu, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function optionKey(value: string | null | undefined) {
  const options = jsonObject(value);
  return Object.keys(options)
    .sort()
    .map((key) => `${key}:${normalized(String(options[key] ?? ""))}`)
    .join("|");
}

function reviewAcknowledgements(
  value: string | null | undefined,
  required: boolean,
) {
  let items: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed))
      items = parsed.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object"),
      );
  } catch {
    items = [];
  }
  const kept = items.filter(
    (item) => item.warning !== "manual-review-required",
  );
  return JSON.stringify(
    required
      ? [
          ...kept,
          {
            warning: "manual-review-required",
            confirmedAt: new Date().toISOString(),
            confirmedBy: "版本比對",
          },
        ]
      : kept,
  );
}

function hasManualReview(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]");
    return (
      Array.isArray(parsed) &&
      parsed.some(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).warning ===
            "manual-review-required",
      )
    );
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const auth = await requireMedtechQuestionEditor(request);
  if ("error" in auth) return auth.error;
  const url = new URL(request.url);
  const requestedId = Number(url.searchParams.get("id"));
  if (!Number.isInteger(requestedId) || requestedId < 1) {
    url.searchParams.set("category", "medtech");
    const response = await getDocuments(
      new Request(url, { headers: request.headers }),
    );
    if (!isLimitedMedtechDocumentEditor(auth.access) || !response.ok)
      return response;
    const data = (await response.json()) as {
      documents?: Array<{ id: number }>;
      [key: string]: unknown;
    };
    return Response.json(
      {
        ...data,
        documents: (data.documents ?? []).filter((document) =>
          canAccessMedtechDocument(auth.access, document.id),
        ),
      },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The workspace needs one document and its source variants only. Avoid the
  // company dashboard query here: it also touches optional analytics/index
  // tables, so one pending Dev migration could hide an otherwise valid PDF.
  try {
    const db = await getDb("primary");
    const [row] = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        subject: documents.subject,
        documentType: documents.documentType,
        processingStage: documents.processingStage,
        questionCount: documents.questionCount,
        processingResultJson: documents.processingResultJson,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, requestedId),
          eq(documents.examCategory, "medtech"),
        ),
      )
      .limit(1);
    if (!row)
      return Response.json(
        { documents: [] },
        { headers: { "Cache-Control": "no-store" } },
      );

    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(row.processingResultJson) as Record<string, unknown>;
    } catch {
      result = {};
    }
    const sourceVariants = Array.isArray(result.sourceVariants)
      ? result.sourceVariants
          .filter((item): item is Record<string, unknown> =>
            Boolean(
              item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).storageKey === "string",
            ),
          )
          .map((item) => ({
            kind: typeof item.kind === "string" ? item.kind : "other",
            storageKey: String(item.storageKey),
            fileName:
              typeof item.fileName === "string" ? item.fileName : "原稿版本",
            contentType:
              typeof item.contentType === "string"
                ? item.contentType
                : "application/octet-stream",
            sizeBytes: Number(item.sizeBytes ?? 0),
          }))
      : [];
    return Response.json(
      {
        documents: [
          {
            id: row.id,
            name: row.fileName,
            subject: row.subject,
            type: row.documentType,
            processingStage: row.processingStage,
            questionCount: Number(row.questionCount ?? 0),
            indexedQuestionCount: Number(row.questionCount ?? 0),
            sourceVariants,
          },
        ],
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 300) : "未知資料庫錯誤";
    console.error("medtech document workspace lookup failed", {
      requestedId,
      detail,
    });
    return Response.json(
      { error: `原稿文件讀取失敗：${detail}` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const form = await request.formData();
  const baseDocumentId = Number(form.get("baseDocumentId"));
  form.set("examCategory", "medtech");
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  const response = await postDocument(
    new Request(request.url, { method: "POST", headers, body: form }),
  );
  if (!response.ok || !Number.isInteger(baseDocumentId) || baseDocumentId < 1)
    return response;
  const data = (await response.json()) as {
    document?: { id?: number };
    error?: string;
  };
  const candidateId = Number(data.document?.id);
  if (!Number.isInteger(candidateId) || candidateId < 1)
    return Response.json(data, { status: response.status });
  const db = await getDb("primary");
  const [base, candidate] = await Promise.all([
    db
      .select({ id: documents.id, bookTitle: documents.bookTitle })
      .from(documents)
      .where(
        and(
          eq(documents.id, baseDocumentId),
          eq(documents.examCategory, "medtech"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        id: documents.id,
        processingResultJson: documents.processingResultJson,
      })
      .from(documents)
      .where(eq(documents.id, candidateId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  if (!base || !candidate)
    return Response.json(
      { error: "版本文件已上傳，但找不到要比對的原文件" },
      { status: 409 },
    );
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(candidate.processingResultJson || "{}");
  } catch {
    result = {};
  }
  await db
    .update(documents)
    .set({
      processingResultJson: JSON.stringify({
        ...result,
        documentVersion: {
          role: "candidate",
          state: "processing",
          baseDocumentId,
          baseBookTitle: base.bookTitle,
          createdAt: new Date().toISOString(),
        },
      }),
      processingMessage:
        "舊版文件已建立為獨立版本，處理完成後可執行新舊題目比對",
    })
    .where(eq(documents.id, candidateId));
  return Response.json(
    {
      ...data,
      documentVersion: {
        role: "candidate",
        state: "processing",
        baseDocumentId,
      },
    },
    { status: response.status },
  );
}

export async function PUT(request: Request) {
  const auth = await requireMedtechQuestionEditor(request);
  if ("error" in auth) return auth.error;
  if (isLimitedMedtechDocumentEditor(auth.access))
    return Response.json(
      { error: "文件題庫編輯員不可更換原稿" },
      { status: 403 },
    );
  try {
    const form = await request.formData();
    const id = Number(form.get("id"));
    const file = form.get("file");
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      !(file instanceof File) ||
      !isSupportedDocument(file.name, file.type)
    )
      return Response.json(
        { error: "請選擇正確的 PDF、HTML 或 Word 原稿" },
        { status: 400 },
      );
    if (file.size > MAX_DOCUMENT_BYTES)
      return Response.json({ error: "文件不可超過 55MB" }, { status: 413 });
    const db = await getDb("primary");
    const [current] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.examCategory, "medtech")))
      .limit(1);
    const linkedQuestions = current
      ? []
      : await db
          .select({ id: examQuestions.id, subject: examQuestions.subject })
          .from(examQuestions)
          .where(
            and(
              eq(examQuestions.examCategory, "medtech"),
              eq(examQuestions.sourceUrl, `document:${id}`),
            ),
          );
    if (!current && !linkedQuestions.length)
      return Response.json(
        { error: "找不到醫檢師文件或其既有題目" },
        { status: 404 },
      );
    const { env } = await import("cloudflare:workers");
    if (!env.BUCKET)
      return Response.json({ error: "文件儲存空間尚未就緒" }, { status: 503 });
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
    const newKey = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const fallbackSubject = linkedQuestions[0]?.subject || "未分類";
    await env.BUCKET.put(newKey, file.stream(), {
      httpMetadata: {
        contentType: contentTypeForDocument(file.name, file.type),
      },
      customMetadata: {
        subject: current?.subject || fallbackSubject,
        documentType: current?.documentType || "題庫",
        bookTitle: current?.bookTitle || file.name,
        originalName: file.name,
      },
    });
    try {
      if (!current) {
        await db.insert(documents).values({
          id,
          storageKey: newKey,
          fileName: file.name,
          contentType: contentTypeForDocument(file.name, file.type),
          sizeBytes: file.size,
          examCategory: "medtech",
          bookTitle: file.name.replace(/\.[^.]+$/u, ""),
          subject: fallbackSubject,
          documentType: "題庫",
          status: "completed",
          processingStage: "completed",
          processingMessage: "已由既有題目補回 PDF 原稿文件紀錄",
          questionCount: linkedQuestions.length,
          processingResultJson: JSON.stringify({ sourceVariants: [] }),
        });
        const [verified] = await db
          .select({
            storageKey: documents.storageKey,
            fileName: documents.fileName,
          })
          .from(documents)
          .where(eq(documents.id, id))
          .limit(1);
        if (
          !verified ||
          verified.storageKey !== newKey ||
          verified.fileName !== file.name
        )
          throw new Error("PDF 已上傳，但文件紀錄寫入後無法讀回");
        return Response.json({
          replaced: true,
          repaired: true,
          persisted: true,
          variant: documentExtension(file.name) ?? "other",
          id,
          name: file.name,
        });
      }
      let parsedResult: Record<string, unknown> = {};
      try {
        parsedResult = JSON.parse(current.processingResultJson) as Record<
          string,
          unknown
        >;
      } catch {
        parsedResult = {};
      }
      const variants = Array.isArray(parsedResult.sourceVariants)
        ? parsedResult.sourceVariants.filter(
            (item): item is Record<string, unknown> =>
              Boolean(
                item &&
                typeof item === "object" &&
                typeof (item as Record<string, unknown>).storageKey ===
                  "string",
              ),
          )
        : [];
      const currentKind = documentExtension(current.fileName);
      const nextKind = documentExtension(file.name);
      const variantKind =
        nextKind === "pdf"
          ? "pdf"
          : nextKind === "html"
            ? "html"
            : (nextKind ?? "other");
      const nextVariants = variants.filter((item) => item.kind !== variantKind);
      // Keep the existing primary object instead of deleting it. A PDF and an
      // HTML rendering can therefore coexist and be switched in the workspace.
      // Re-uploading the same kind is a replacement, not another source
      // variant. This prevents repeated PDF uploads from accumulating duplicate
      // originals while still allowing one PDF and one HTML source to coexist.
      if (currentKind !== variantKind) {
        nextVariants.push({
          kind:
            currentKind === "pdf"
              ? "pdf"
              : currentKind === "html"
                ? "html"
                : (currentKind ?? "other"),
          storageKey: current.storageKey,
          fileName: current.fileName,
          contentType: current.contentType,
          sizeBytes: current.sizeBytes,
          createdAt: new Date().toISOString(),
        });
      }
      await db
        .update(documents)
        .set({
          storageKey: newKey,
          fileName: file.name,
          contentType: contentTypeForDocument(file.name, file.type),
          sizeBytes: file.size,
          processingMessage: `已新增${variantKind === "html" ? " HTML" : variantKind === "pdf" ? " PDF" : "原稿版本"}；既有題目、解析與順序均保留，未重新拆題`,
          processingResultJson: JSON.stringify({
            ...parsedResult,
            sourceVariants: nextVariants,
          }),
          indexError: null,
        })
        .where(eq(documents.id, id));
      const [verified] = await db
        .select({
          storageKey: documents.storageKey,
          fileName: documents.fileName,
        })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1);
      if (
        !verified ||
        verified.storageKey !== newKey ||
        verified.fileName !== file.name
      )
        throw new Error("PDF 已上傳，但文件紀錄更新後無法讀回");
      if (currentKind === variantKind && current.storageKey !== newKey) {
        await env.BUCKET.delete(current.storageKey).catch(() => undefined);
      }
      return Response.json({
        replaced: true,
        persisted: true,
        variant: variantKind,
        id,
        name: file.name,
        variants: nextVariants.map((item) => ({
          kind: item.kind,
          fileName: item.fileName,
        })),
      });
    } catch (error) {
      await env.BUCKET.delete(newKey).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message.slice(0, 240) : "更換文件失敗",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as {
    id?: number;
    baseDocumentId?: number;
    action?: string;
    homepageSearchEnabled?: boolean;
    subject?: string;
    bookTitle?: string;
  };
  const db = await getDb();
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, Number(body.id)),
        eq(documents.examCategory, "medtech"),
      ),
    )
    .limit(1);
  if (!row)
    return Response.json({ error: "找不到醫檢師教材" }, { status: 404 });
  if (body.action === "compareVersion") {
    const candidateId = row.id;
    const candidateResult = jsonObject(row.processingResultJson);
    const savedVersion =
      candidateResult.documentVersion &&
      typeof candidateResult.documentVersion === "object"
        ? (candidateResult.documentVersion as Record<string, unknown>)
        : {};
    const baseDocumentId = Number(
      body.baseDocumentId || savedVersion.baseDocumentId,
    );
    if (
      !Number.isInteger(baseDocumentId) ||
      baseDocumentId < 1 ||
      baseDocumentId === candidateId
    )
      return Response.json(
        { error: "請選擇正確的原版本文件" },
        { status: 400 },
      );
    if (row.processingStage !== "completed")
      return Response.json(
        { error: "舊版文件仍在處理中，請完成拆題後再比對" },
        { status: 409 },
      );
    const [base] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, baseDocumentId),
          eq(documents.examCategory, "medtech"),
        ),
      )
      .limit(1);
    if (!base)
      return Response.json(
        { error: "找不到要比對的原版本文件" },
        { status: 404 },
      );
    const [baseQuestions, candidateQuestions] = await Promise.all([
      db
        .select()
        .from(examQuestions)
        .where(
          and(
            eq(examQuestions.examCategory, "medtech"),
            eq(examQuestions.sourceUrl, `document:${baseDocumentId}`),
          ),
        ),
      db
        .select()
        .from(examQuestions)
        .where(
          and(
            eq(examQuestions.examCategory, "medtech"),
            eq(examQuestions.sourceUrl, `document:${candidateId}`),
          ),
        ),
    ]);
    if (!candidateQuestions.length)
      return Response.json(
        { error: "舊版文件尚未拆出題目，請先進入工作區完成拆題" },
        { status: 409 },
      );
    if (!baseQuestions.length)
      return Response.json(
        { error: "原版本沒有可供比對的題目" },
        { status: 409 },
      );

    const exactMap = new Map<string, typeof baseQuestions>();
    const stemMap = new Map<string, typeof baseQuestions>();
    const numberMap = new Map<string, typeof baseQuestions>();
    const add = (
      map: Map<string, typeof baseQuestions>,
      key: string,
      question: (typeof baseQuestions)[number],
    ) => {
      if (!key) return;
      map.set(key, [...(map.get(key) ?? []), question]);
    };
    for (const question of baseQuestions) {
      const stem = normalized(question.stem);
      add(exactMap, `${stem}|${optionKey(question.optionsJson)}`, question);
      add(stemMap, stem, question);
      add(
        numberMap,
        `${normalized(question.year)}|${normalized(question.questionNumber)}`,
        question,
      );
    }
    const usedBaseIds = new Set<number>();
    const take = (items: typeof baseQuestions | undefined) =>
      items?.find((item) => !usedBaseIds.has(item.id));
    let identical = 0;
    let changed = 0;
    let added = 0;
    const statements = candidateQuestions.map((question) => {
      const stem = normalized(question.stem);
      const exact = take(
        exactMap.get(`${stem}|${optionKey(question.optionsJson)}`),
      );
      const related =
        exact ||
        take(stemMap.get(stem)) ||
        take(
          numberMap.get(
            `${normalized(question.year)}|${normalized(question.questionNumber)}`,
          ),
        );
      if (related) usedBaseIds.add(related.id);
      if (exact) {
        identical += 1;
        return db
          .update(examQuestions)
          .set({
            teacherAnswer: exact.teacherAnswer,
            correctAnswer: exact.teacherAnswer || exact.correctAnswer,
            completeExplanation: exact.completeExplanation,
            aiCompleteExplanation: exact.aiCompleteExplanation,
            teacherCompleteExplanation: exact.teacherCompleteExplanation,
            reviewStatus: exact.reviewStatus,
            reviewedAt: exact.reviewedAt,
            qualityAcknowledgementsJson: reviewAcknowledgements(
              question.qualityAcknowledgementsJson,
              false,
            ),
            status: "draft",
          })
          .where(eq(examQuestions.id, question.id));
      }
      if (related) changed += 1;
      else added += 1;
      return db
        .update(examQuestions)
        .set({
          qualityAcknowledgementsJson: reviewAcknowledgements(
            question.qualityAcknowledgementsJson,
            true,
          ),
          reviewStatus: "pending",
          reviewedAt: null,
          status: "draft",
        })
        .where(eq(examQuestions.id, question.id));
    });
    for (let start = 0; start < statements.length; start += 50) {
      const chunk = statements.slice(start, start + 50);
      if (chunk[0]) await db.batch([chunk[0], ...chunk.slice(1)]);
    }
    const comparison = {
      identical,
      changed,
      added,
      baseOnly: baseQuestions.length - usedBaseIds.size,
      comparedAt: new Date().toISOString(),
    };
    await db
      .update(documents)
      .set({
        processingResultJson: JSON.stringify({
          ...candidateResult,
          documentVersion: {
            ...savedVersion,
            role: "candidate",
            state: "compared",
            baseDocumentId,
            comparison,
          },
        }),
        processingMessage: `版本比對完成：相同 ${identical} 題、需人工確認 ${changed + added} 題`,
      })
      .where(eq(documents.id, candidateId));
    return Response.json({ compared: true, comparison });
  }
  if (body.action === "activateVersion") {
    const candidateResult = jsonObject(row.processingResultJson);
    const version =
      candidateResult.documentVersion &&
      typeof candidateResult.documentVersion === "object"
        ? (candidateResult.documentVersion as Record<string, unknown>)
        : {};
    const baseDocumentId = Number(version.baseDocumentId);
    if (
      version.state !== "compared" ||
      !Number.isInteger(baseDocumentId) ||
      baseDocumentId < 1
    )
      return Response.json({ error: "請先完成新舊題目比對" }, { status: 409 });
    const candidateQuestions = await db
      .select()
      .from(examQuestions)
      .where(
        and(
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.sourceUrl, `document:${row.id}`),
        ),
      );
    const pendingManual = candidateQuestions.filter((question) =>
      hasManualReview(question.qualityAcknowledgementsJson),
    );
    if (pendingManual.length)
      return Response.json(
        {
          error: `尚有 ${pendingManual.length} 題需要人工確認，請先從工作區篩選處理`,
        },
        { status: 409 },
      );
    await db
      .update(examQuestions)
      .set({ status: "disabled" })
      .where(
        and(
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.sourceUrl, `document:${baseDocumentId}`),
        ),
      );
    const publishableCount = candidateQuestions.filter((question) =>
      /^[A-D]$/iu.test(
        String(question.teacherAnswer || question.correctAnswer || "").trim(),
      ),
    ).length;
    const publishStatements = candidateQuestions.map((question) =>
      db
        .update(examQuestions)
        .set({
          status: /^[A-D]$/iu.test(
            String(
              question.teacherAnswer || question.correctAnswer || "",
            ).trim(),
          )
            ? "published"
            : "draft",
        })
        .where(eq(examQuestions.id, question.id)),
    );
    for (let start = 0; start < publishStatements.length; start += 50) {
      const chunk = publishStatements.slice(start, start + 50);
      if (chunk[0]) await db.batch([chunk[0], ...chunk.slice(1)]);
    }
    const [base] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, baseDocumentId))
      .limit(1);
    if (base) {
      const baseResult = jsonObject(base.processingResultJson);
      await db
        .update(documents)
        .set({
          processingResultJson: JSON.stringify({
            ...baseResult,
            documentVersion: {
              role: "archived",
              replacedByDocumentId: row.id,
              archivedAt: new Date().toISOString(),
            },
          }),
          processingMessage: "此版本已封存，題庫已切換至另一版本",
        })
        .where(eq(documents.id, baseDocumentId));
    }
    await db
      .update(documents)
      .set({
        processingResultJson: JSON.stringify({
          ...candidateResult,
          documentVersion: {
            ...version,
            role: "active",
            state: "active",
            activatedAt: new Date().toISOString(),
          },
        }),
        processingMessage: "此版本目前為正式使用版本",
      })
      .where(eq(documents.id, row.id));
    return Response.json({
      activated: true,
      published: publishableCount,
      draft: candidateQuestions.length - publishableCount,
      archivedDocumentId: baseDocumentId,
    });
  }
  if (typeof body.subject === "string") {
    const subject = body.subject.replace(/\s+/gu, " ").trim().slice(0, 80);
    if (!subject)
      return Response.json({ error: "請輸入科目名稱" }, { status: 400 });
    await db.update(documents).set({ subject }).where(eq(documents.id, row.id));
    await db
      .update(examQuestions)
      .set({ subject })
      .where(
        and(
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.sourceUrl, `document:${row.id}`),
        ),
      );
    return Response.json({
      id: row.id,
      subject,
      questionsUpdated: row.questionCount,
    });
  }
  if (typeof body.bookTitle === "string") {
    const bookTitle = body.bookTitle.replace(/\s+/gu, " ").trim().slice(0, 200);
    if (!bookTitle)
      return Response.json({ error: "請輸入書籍名稱" }, { status: 400 });
    await db
      .update(documents)
      .set({ bookTitle })
      .where(eq(documents.id, row.id));
    await db
      .update(examQuestions)
      .set({ answerSource: bookTitle })
      .where(
        and(
          eq(examQuestions.examCategory, "medtech"),
          eq(examQuestions.sourceUrl, `document:${row.id}`),
        ),
      );
    return Response.json({ id: row.id, bookTitle });
  }
  return patchDocument(
    new Request(request.url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function DELETE(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json()) as { ids?: unknown[] };
  const ids = (body.ids ?? []).map(Number).filter(Number.isInteger);
  const db = await getDb();
  const allowed = ids.length
    ? await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.examCategory, "medtech"),
            inArray(documents.id, ids),
          ),
        )
    : [];
  return deleteDocuments(
    new Request(request.url, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: allowed.map((row) => row.id) }),
    }),
  );
}
