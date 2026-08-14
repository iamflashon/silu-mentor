import { getDb } from "../../../../db";
import { documents } from "../../../../db/schema";
import { contentTypeForDocument, isSupportedDocument, MAX_DOCUMENT_BYTES } from "../../../../lib/document-processing";

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
        const db = await getDb();
        const [row] = await db.insert(documents).values({
          storageKey: body.key,
          fileName: body.fileName,
          contentType: contentTypeForDocument(body.fileName, body.contentType),
          sizeBytes: body.sizeBytes,
          examCategory: ["law", "accounting", "medtech", "data-structure"].includes(body.examCategory) ? body.examCategory : "law",
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
