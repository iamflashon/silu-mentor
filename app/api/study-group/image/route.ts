export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/^image\/(?:jpeg|png|webp)$/.test(file.type))
      return Response.json({ error: "請選擇 JPG、PNG 或 WebP 圖片" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024)
      return Response.json({ error: "圖片請勿超過 4MB" }, { status: 400 });
    const key = `study-group/${crypto.randomUUID()}`;
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
    if (!/^study-group\/[a-f0-9-]{36}$/.test(key)) return new Response("Not found", { status: 404 });
    const { env } = await import("cloudflare:workers");
    const object = await env.BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "image/jpeg",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
