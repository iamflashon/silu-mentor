import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings, documents } from "../../../../db/schema";
import { openAIHeaders, openAIJson } from "../../../../lib/openai";

async function getVectorStoreId() {
  const db = await getDb();
  const [saved] = await db.select().from(appSettings).where(eq(appSettings.key, "openai_vector_store_id")).limit(1);
  if (saved?.value) return saved.value;

  const created = await openAIJson("/vector_stores", {
    method: "POST",
    body: JSON.stringify({ name: "司律導師教材知識庫" }),
  });
  const id = typeof created.id === "string" ? created.id : "";
  if (!id) throw new Error("無法建立教材向量資料庫");
  await db.insert(appSettings).values({ key: "openai_vector_store_id", value: id }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: id, updatedAt: new Date() },
  });
  return id;
}

export async function POST(request: Request) {
  let documentId = 0;
  try {
    const body = await request.json() as { documentId?: number };
    documentId = Number(body.documentId);
    if (!Number.isInteger(documentId) || documentId < 1) {
      return Response.json({ error: "文件編號不正確" }, { status: 400 });
    }

    const db = await getDb();
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    if (!document) return Response.json({ error: "找不到這份文件" }, { status: 404 });
    await db.update(documents).set({ status: "uploading_to_index", indexError: null }).where(eq(documents.id, documentId));

    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(document.storageKey);
    if (!object) throw new Error("找不到已上傳的 PDF 原檔");

    const form = new FormData();
    form.set("purpose", "assistants");
    form.set("file", new File([await object.arrayBuffer()], document.fileName, { type: document.contentType }));
    const fileResponse = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: openAIHeaders(false),
      body: form,
    });
    const filePayload = await fileResponse.json() as { id?: string; error?: { message?: string } };
    if (!fileResponse.ok || !filePayload.id) throw new Error(filePayload.error?.message ?? "PDF 無法送入索引服務");

    const vectorStoreId = await getVectorStoreId();
    const indexed = await openAIJson(`/vector_stores/${vectorStoreId}/files`, {
      method: "POST",
      body: JSON.stringify({
        file_id: filePayload.id,
        attributes: { subject: document.subject, document_type: document.documentType },
      }),
    });
    await db.update(documents).set({
      status: typeof indexed.status === "string" ? indexed.status : "in_progress",
      openaiFileId: filePayload.id,
      indexError: null,
    }).where(eq(documents.id, documentId));

    return Response.json({ status: indexed.status ?? "in_progress" });
  } catch (error) {
    if (documentId) {
      try {
        const db = await getDb();
        await db.update(documents).set({ status: "failed", indexError: error instanceof Error ? error.message.slice(0, 300) : "建立索引失敗" }).where(eq(documents.id, documentId));
      } catch { /* keep original error */ }
    }
    return Response.json({ error: error instanceof Error ? error.message : "建立索引失敗" }, { status: 500 });
  }
}
