import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { contentTypeForDocument, documentExtension, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../../lib/document-processing";
import { documentDisplayTitle } from "../../../../lib/document-title";
import { requireAdmin } from "../../../../lib/member-auth";

type InitPayload = {
  action: "init";
  fileName: string;
  contentType: string;
};

type CompletePayload = {
  action: "complete";
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  examCategory: string;
  subject: string;
  documentType: string;
  replaceDocumentId?: number;
  existingQuestionCount?: number;
};

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

async function getBucket() {
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("bucket unavailable");
  return env.BUCKET;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as InitPayload | CompletePayload;
    const bucket = await getBucket();

    if (body.action === "init") {
      if (!body.fileName || !isSupportedDocument(body.fileName, body.contentType)) {
        return Response.json({ error: "請選擇 PDF、HTML、JSONL、MD、TXT、DOCX 或 ZIP 文件" }, { status: 400 });
      }
      const key = `documents/${Date.now()}-${crypto.randomUUID()}-${safeName(body.fileName)}`;
      const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: contentTypeForDocument(body.fileName, body.contentType) },
      });
      return Response.json({ key, uploadId: upload.uploadId });
    }

    if (body.action === "complete") {
      if (!body.key.startsWith("documents/") || !body.uploadId || !body.parts.length || body.sizeBytes < 1 || body.sizeBytes > MAX_DOCUMENT_BYTES) {
        return Response.json({ error: "上傳資料不完整" }, { status: 400 });
      }
      const upload = bucket.resumeMultipartUpload(body.key, body.uploadId);
      await upload.complete(body.parts);

      try {
        const db = await getDb("primary");
        if (Number.isInteger(body.replaceDocumentId) && Number(body.replaceDocumentId) > 0) {
          const auth = await requireAdmin(request);
          if ("error" in auth) {
            await bucket.delete(body.key);
            return auth.error;
          }
          const [current] = await db.select().from(documents).where(eq(documents.id, Number(body.replaceDocumentId))).limit(1);
          if (!current) {
            // Some Dev databases were imported with exam_questions but without
            // the matching documents row. Rebuild that missing parent record
            // at the same logical id so refreshes can resolve and retain the
            // uploaded PDF instead of falling back to "文件 {id}" / Word view.
            const category = ["law", "accounting", "medtech", "data-structure"].includes(body.examCategory) ? body.examCategory : "law";
            const questionCount = Number.isInteger(body.existingQuestionCount) ? Math.max(0, Number(body.existingQuestionCount)) : 0;
            await db.insert(documents).values({
              id: Number(body.replaceDocumentId),
              storageKey: body.key,
              fileName: body.fileName,
              contentType: contentTypeForDocument(body.fileName, body.contentType),
              sizeBytes: body.sizeBytes,
              examCategory: category,
              bookTitle: documentDisplayTitle(null, body.fileName),
              subject: body.subject || "未分類",
              documentType: body.documentType || "題庫",
              status: "completed",
              processingStage: "completed",
              processingMessage: "已補回遺失的原稿文件紀錄；既有題目與解析均保留",
              questionCount,
              processingResultJson: JSON.stringify({ sourceVariants: [] }),
            });
            return Response.json({ replaced: true, repaired: true, variant: documentExtension(body.fileName) ?? "other", id: Number(body.replaceDocumentId), name: body.fileName });
          }
          let result: Record<string, unknown> = {};
          try { result = JSON.parse(current.processingResultJson) as Record<string, unknown>; } catch { result = {}; }
          const variants = Array.isArray(result.sourceVariants)
            ? result.sourceVariants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as Record<string, unknown>).storageKey === "string"))
            : [];
          const currentKind = documentExtension(current.fileName) ?? "other";
          const nextKind = documentExtension(body.fileName) ?? "other";
          const nextVariants = variants.filter(item => item.kind !== nextKind && item.storageKey !== current.storageKey);
          nextVariants.push({ kind: currentKind, storageKey: current.storageKey, fileName: current.fileName, contentType: current.contentType, sizeBytes: current.sizeBytes, createdAt: new Date().toISOString() });
          await db.update(documents).set({
            storageKey: body.key,
            fileName: body.fileName,
            contentType: contentTypeForDocument(body.fileName, body.contentType),
            sizeBytes: body.sizeBytes,
            processingMessage: `已新增 ${nextKind.toUpperCase()} 原稿版本；既有題目與解析均保留`,
            processingResultJson: JSON.stringify({ ...result, sourceVariants: nextVariants }),
            indexError: null,
          }).where(eq(documents.id, current.id));
          return Response.json({ replaced: true, variant: nextKind, id: current.id, name: body.fileName });
        }
        const [row] = await db.insert(documents).values({
          storageKey: body.key,
          fileName: body.fileName,
          contentType: contentTypeForDocument(body.fileName, body.contentType),
          sizeBytes: body.sizeBytes,
          examCategory: ["law", "accounting", "medtech", "data-structure"].includes(body.examCategory) ? body.examCategory : "law",
          bookTitle: documentDisplayTitle(null, body.fileName),
          subject: body.subject,
          documentType: body.documentType,
          status: "uploaded",
        }).returning();
        return Response.json({ document: { id: row.id, name: row.fileName, status: row.status } }, { status: 201 });
      } catch (error) {
        await bucket.delete(body.key);
        throw error;
      }
    }

    return Response.json({ error: "不支援的上傳動作" }, { status: 400 });
  } catch {
    return Response.json({ error: "教材文件上傳失敗，請稍後再試" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") ?? "";
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!key.startsWith("documents/") || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
      return Response.json({ error: "分段上傳資料不完整" }, { status: 400 });
    }
    const bucket = await getBucket();
    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body!);
    return Response.json({ partNumber: part.partNumber, etag: part.etag });
  } catch {
    return Response.json({ error: "教材分段上傳失敗" }, { status: 500 });
  }
}
