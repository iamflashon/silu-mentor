export async function GET(request: Request) {
  void request;
  return new Response("書籍前台不提供 PDF 閱讀或下載，請從章節進入 AI 教學。", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
