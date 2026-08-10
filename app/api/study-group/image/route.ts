export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const isImage = file instanceof File && /^image\/(?:jpeg|png|webp)$/.test(file.type);
    const isPdf = file instanceof File && file.type === "application/pdf";
    if (!isImage && !isPdf)
      return Response.json({ error: "請選擇 JPG、PNG、WebP 圖片或 PDF" }, { status: 400 });
    if ((isImage && file.size > 4 * 1024 * 1024) || (isPdf && file.size > 12 * 1024 * 1024))
      return Response.json({ error: isPdf ? "PDF 請勿超過 12MB" : "圖片請勿超過 4MB" }, { status: 400 });
    const key = `study-group/${crypto.randomUUID()}${isPdf ? ".pdf" : ""}`;
    const { env } = await import("cloudflare:workers");
    await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    return Response.json({ url: `/api/study-group/image?key=${encodeURIComponent(key)}` });
  } catch {
    return Response.json({ error: "圖片暫時無法上傳" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  try {
    const key = new URL(request.url).searchParams.get("key") || "";
    if (!/^study-group\/[a-f0-9-]{36}(?:\.pdf)?$/.test(key)) return new Response("Not found", { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "content-disposition": key.endsWith(".pdf") ? "inline" : "",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
