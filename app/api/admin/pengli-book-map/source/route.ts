import { desc, eq, like, or } from "drizzle-orm";
import { documents } from "../../../../../db/schema";
import { requireAdmin } from "../../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  const [selected] = await auth.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!selected) return new Response("Not found", { status: 404 });
  let storageKey = selected.storageKey, fileName = selected.fileName, contentType = selected.contentType;
  if (!/\.pdf$/iu.test(fileName)) {
    try {
      const parsed = JSON.parse(selected.processingResultJson) as { sourceVariants?: Array<{ kind?: string; storageKey?: string; fileName?: string; contentType?: string }> };
      const variant = (parsed.sourceVariants ?? []).filter((item) => item.kind === "pdf" && item.storageKey).at(-1);
      if (variant?.storageKey) { storageKey = variant.storageKey; fileName = variant.fileName || fileName; contentType = variant.contentType || "application/pdf"; }
      else {
        const candidates = await auth.db.select().from(documents).where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%"))).orderBy(desc(documents.id)).limit(20);
        const pdf = candidates.find((item) => /\.pdf$/iu.test(item.fileName));
        if (!pdf) return new Response("這份教材目前只有逐頁索引，尚未保存私有 PDF 原稿。", { status: 404 });
        storageKey = pdf.storageKey; fileName = pdf.fileName; contentType = pdf.contentType;
      }
    } catch { return new Response("這份教材目前沒有可開啟的私有 PDF 原稿。", { status: 404 }); }
  }
  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET.get(storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "content-type": contentType || "application/pdf", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request); if ("error" in auth) return auth.error;
  const form = await request.formData(), id = Number(form.get("id")), file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") return Response.json({ error: "請選擇 PDF 原稿。" }, { status: 400 });
  if (file.size > 120 * 1024 * 1024) return Response.json({ error: "PDF 原稿不可超過 120 MB。" }, { status: 413 });
  const [selected] = await auth.db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!selected) return Response.json({ error: "找不到教材索引。" }, { status: 404 });
  const storageKey = `private/pengli-source/${id}-${crypto.randomUUID()}.pdf`;
  const { env } = await import("cloudflare:workers");
  await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: "application/pdf" }, customMetadata: { originalName: file.name, access: "admin-only", indexDocumentId: String(id) } });
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(selected.processingResultJson) as Record<string, unknown>; } catch { /* start clean */ }
  const existing = Array.isArray(parsed.sourceVariants) ? parsed.sourceVariants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const oldPdfKeys = existing.filter((item) => item.kind === "pdf" && typeof item.storageKey === "string").map((item) => String(item.storageKey));
  const nextVariants = [...existing.filter((item) => item.kind !== "pdf"), { kind: "pdf", storageKey, fileName: file.name, contentType: "application/pdf", sizeBytes: file.size, createdAt: new Date().toISOString(), access: "admin-only" }];
  await auth.db.update(documents).set({ processingResultJson: JSON.stringify({ ...parsed, sourceVariants: nextVariants }) }).where(eq(documents.id, id));
  for (const key of oldPdfKeys) if (key !== storageKey) await env.BUCKET.delete(key);
  return Response.json({ ok: true });
}
