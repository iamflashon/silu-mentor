import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { legalDataSources } from "../../../../db/schema";

const allowedSources = new Set(["moj-regulations"]);
const maxArchiveBytes = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const sourceKey = String(form.get("sourceKey") ?? "");
  const file = form.get("file");
  if (!allowedSources.has(sourceKey))
    return Response.json({ error: "ZIP 請匯入全國法規資料來源" }, { status: 400 });
  if (!(file instanceof File))
    return Response.json({ error: "請選擇 ZIP 檔案" }, { status: 400 });
  if (file.size > maxArchiveBytes)
    return Response.json({ error: "ZIP 超過 200 MB 上傳限制" }, { status: 413 });
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip")
    return Response.json({ error: "請上傳 .zip 檔案" }, { status: 400 });

  let files: Record<string, Uint8Array>;
  let hasLawData = false;
  let hasOrderData = false;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    files = unzipSync(bytes);
    hasLawData = Object.keys(files).some((name) => /(^|\/)ChLaw\.json$/i.test(name));
    hasOrderData = Object.keys(files).some((name) => /(^|\/)ChOrder\.json$/i.test(name));
    if (!hasLawData && !hasOrderData)
      throw new Error("ZIP 裡找不到 ChLaw.json 或 ChOrder.json，請確認這是全國法規資料包");
    const { env } = await import("cloudflare:workers");
    const key = `legal-archives/${sourceKey}-${Date.now()}.zip`;
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: "application/zip" },
    });
    const db = await getDb();
    const [source] = await db
      .select()
      .from(legalDataSources)
      .where(eq(legalDataSources.sourceKey, sourceKey))
      .limit(1);
    if (!source) return Response.json({ error: "找不到全國法規資料來源" }, { status: 404 });
    await db
      .update(legalDataSources)
      .set({
        status: "uploaded",
        archiveStorageKey: key,
        importCursor: 0,
        totalAvailable: 0,
        documentCount: 0,
        articleCount: 0,
        lastError: null,
        lastDownloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(legalDataSources.id, source.id));
    return Response.json({ sourceKey, status: "uploaded", fileName: file.name, categories: { 法律: hasLawData, 命令: hasOrderData } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message.slice(0, 300) : "ZIP 無法讀取" },
      { status: 400 },
    );
  }
}
