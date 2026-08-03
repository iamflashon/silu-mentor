import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { legalDataSources } from "../../../../db/schema";

const allowedSources = new Set(["moj-regulations"]);
const maxArchiveBytes = 2 * 1024 * 1024 * 1024;
export const legalZipPartSize = 8 * 1024 * 1024;

type InitPayload = {
  action: "init";
  sourceKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

type CompletePayload = {
  action: "complete";
  sourceKey: string;
  key: string;
  uploadId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  parts: Array<{ partNumber: number; etag: string }>;
};

function safeName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120);
}

async function getBucket() {
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) throw new Error("文件儲存空間尚未就緒");
  return env.BUCKET;
}

function validZip(fileName: string, contentType: string) {
  return /\.zip$/i.test(fileName) || contentType === "application/zip";
}

export async function POST(request: Request) {
  let body: InitPayload | CompletePayload;
  try {
    body = (await request.json()) as InitPayload | CompletePayload;
  } catch {
    return Response.json({ error: "上傳資料格式不正確" }, { status: 400 });
  }

  if (!allowedSources.has(String(body.sourceKey ?? ""))) {
    return Response.json({ error: "ZIP 請匯入全國法規資料來源" }, { status: 400 });
  }

  if (body.action === "init") {
    if (!body.fileName || !validZip(body.fileName, body.contentType)) {
      return Response.json({ error: "請選擇 .zip 全國法規資料包" }, { status: 400 });
    }
    if (!Number.isSafeInteger(body.sizeBytes) || body.sizeBytes <= 0 || body.sizeBytes > maxArchiveBytes) {
      return Response.json({ error: "ZIP 不可超過 2GB" }, { status: 413 });
    }

    try {
      const bucket = await getBucket();
      const key = `legal-archives/${Date.now()}-${crypto.randomUUID()}-${safeName(body.fileName)}`;
      const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: {
          sourceKey: body.sourceKey,
          originalName: body.fileName,
          sizeBytes: String(body.sizeBytes),
        },
      });
      return Response.json({
        key,
        uploadId: upload.uploadId,
        partSize: legalZipPartSize,
        maxArchiveBytes,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message.slice(0, 300) : "無法建立 ZIP 分段上傳" },
        { status: 503 },
      );
    }
  }

  if (body.action === "complete") {
    if (
      !body.key.startsWith("legal-archives/") ||
      !body.uploadId ||
      !body.fileName ||
      !validZip(body.fileName, body.contentType) ||
      !Number.isSafeInteger(body.sizeBytes) ||
      body.sizeBytes <= 0 ||
      body.sizeBytes > maxArchiveBytes ||
      !Array.isArray(body.parts) ||
      !body.parts.length
    ) {
      return Response.json({ error: "ZIP 分段上傳資料不完整" }, { status: 400 });
    }

    try {
      const bucket = await getBucket();
      const upload = bucket.resumeMultipartUpload(body.key, body.uploadId);
      const parts = body.parts
        .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
        .sort((left, right) => left.partNumber - right.partNumber);
      if (!parts.length) return Response.json({ error: "沒有可組合的 ZIP 分段" }, { status: 400 });
      await upload.complete(parts);

      const db = await getDb();
      const [source] = await db
        .select()
        .from(legalDataSources)
        .where(eq(legalDataSources.sourceKey, body.sourceKey))
        .limit(1);
      if (!source) {
        await bucket.delete(body.key);
        return Response.json({ error: "找不到全國法規資料來源" }, { status: 404 });
      }

      await db
        .update(legalDataSources)
        .set({
          status: "uploaded",
          archiveStorageKey: body.key,
          importCursor: 0,
          totalAvailable: 0,
          documentCount: 0,
          articleCount: 0,
          lastError: null,
          lastDownloadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(legalDataSources.id, source.id));

      return Response.json({
        sourceKey: body.sourceKey,
        status: "uploaded",
        fileName: body.fileName,
        sizeBytes: body.sizeBytes,
        message: "ZIP 已在 R2 組合完成，接著開始解析、分類法律／命令並建立索引",
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message.slice(0, 300) : "ZIP 組合失敗" },
        { status: 500 },
      );
    }
  }

  return Response.json({ error: "不支援的上傳動作" }, { status: 400 });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!key.startsWith("legal-archives/") || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || !request.body) {
    return Response.json({ error: "ZIP 分段資料不完整" }, { status: 400 });
  }

  try {
    const bucket = await getBucket();
    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return Response.json({ partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message.slice(0, 300) : "ZIP 分段上傳失敗" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const uploadId = url.searchParams.get("uploadId") ?? "";
  if (!key.startsWith("legal-archives/") || !uploadId) {
    return Response.json({ error: "ZIP 分段上傳資料不完整" }, { status: 400 });
  }
  try {
    const bucket = await getBucket();
    await bucket.resumeMultipartUpload(key, uploadId).abort();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "無法取消 ZIP 分段上傳" }, { status: 500 });
  }
}
