import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documents } from "../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../lib/member-auth";

type SourceVariant = { kind?: string; storageKey?: string; fileName?: string; contentType?: string };

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attachOriginalPdfPreview(html: string, pdfUrl: string, fileName: string) {
  const visualHtml = `<section class="original-pdf" style="margin:18px 0;padding:12px;border:1px solid #b8d8d3;border-radius:14px;background:#dfecea"><strong style="display:block;padding:4px 8px 12px;color:#146f65">表格與圖片完整保留（原始 PDF）</strong><iframe src="${escapeHtml(pdfUrl)}#page=1&zoom=page-width" title="${escapeHtml(fileName)}" style="display:block;width:100%;height:min(78vh,900px);min-height:560px;border:0;border-radius:8px;background:#fff"></iframe></section>`;
  return html
    .replace("PDF 文字對照版", "原始 PDF 視覺對照＋文字索引")
    .replace("此頁由原始 PDF 逐頁擷取文字，方便搜尋與對照；圖片、表格與原始版面請切回「PDF 原稿」查看，原始 PDF 未被修改。", "上方保留原始 PDF 的表格、圖片、字型與版面；下方文字供搜尋與拆題，表格與圖片以上方原始 PDF 為準。")
    .replace("</small></div>", `</small></div>${visualHtml}`);
}

function variants(value: string) {
  try {
    const parsed = JSON.parse(value) as { sourceVariants?: SourceVariant[] };
    return Array.isArray(parsed.sourceVariants) ? parsed.sourceVariants : [];
  } catch {
    return [] as SourceVariant[];
  }
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return new Response("缺少文件編號", { status: 400 });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.examCategory, "medtech"))).limit(1);
  if (!doc) return new Response("找不到醫檢原稿", { status: 404 });

  let storageKey = doc.storageKey;
  let fileName = doc.fileName;
  if (!/\.pdf$/iu.test(fileName)) {
    const pdf = variants(doc.processingResultJson).filter((item) => item.kind === "pdf" && item.storageKey).at(-1);
    if (!pdf?.storageKey) return new Response("這份文件沒有可轉換的 PDF 原稿", { status: 415 });
    storageKey = pdf.storageKey;
    fileName = pdf.fileName || fileName;
  }

  const { env } = await import("cloudflare:workers");
  const object = await env.BUCKET?.get(storageKey);
  if (!object) return new Response("找不到 PDF 原稿", { status: 404 });
  try {
    const { extractText } = await import("unpdf");
    const extracted = await extractText(new Uint8Array(await object.arrayBuffer()), { mergePages: false });
    const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
    const pageMarkup = pages.map((page, index) => `<section class="pdf-page" id="page-${index + 1}"><div class="page-label">第 ${index + 1} 頁</div><pre>${escapeHtml(page)}</pre></section>`).join("\n");
    const title = `${fileName.replace(/\.pdf$/iu, "")} · HTML 對照版`;
    const pdfUrl = `/api/medtech/admin/document-source?id=${id}${storageKey === doc.storageKey ? "" : "&variant=pdf"}`;
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style> :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eef6f4;color:#164e49;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.pdf-converted{max-width:1100px;margin:0 auto;padding:28px 24px 72px}.intro{padding:18px 20px;margin-bottom:18px;border:1px solid #c1ddd8;border-radius:14px;background:#fff;line-height:1.7}.intro strong{display:block;margin-bottom:4px;color:#146f65}.intro small{color:#6a8581}.pdf-page{margin:18px 0;padding:22px 26px;min-height:140px;border:1px solid #d1e3df;border-radius:12px;background:#fff;box-shadow:0 7px 20px rgba(22,78,73,.05)}.page-label{padding-bottom:10px;margin-bottom:14px;border-bottom:1px solid #e2eeec;color:#18776c;font-size:13px;font-weight:800}pre{margin:0;white-space:pre-wrap;word-break:break-word;font:15px/1.85 ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans TC",sans-serif;color:#214f4b}@media(max-width:700px){.pdf-converted{padding:16px 12px 48px}.pdf-page{padding:16px 14px}pre{font-size:14px;line-height:1.7}}</style></head><body><main class="pdf-converted"><div class="intro"><strong>PDF 文字對照版</strong><div>${escapeHtml(fileName)}</div><small>此頁由原始 PDF 逐頁擷取文字，方便搜尋與對照；圖片、表格與原始版面請切回「PDF 原稿」查看，原始 PDF 未被修改。</small></div>${pageMarkup || '<div class="intro">此 PDF 沒有可擷取的文字，請切回 PDF 原稿查看掃描頁面或圖片內容。</div>'}</main></body></html>`;
    return new Response(attachOriginalPdfPreview(html, pdfUrl, fileName), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(title)}.html`, "cache-control": "private, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'" } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "PDF 轉 HTML 失敗", { status: 422 });
  }
}
