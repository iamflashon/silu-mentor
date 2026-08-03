function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function readableText(html: string) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const term = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!term) return Response.json({ error: "請輸入法律名詞" }, { status: 400 });
  const sourceUrl = `https://terms.judicial.gov.tw/TermContent.aspx?SYS=V&TRMTERM=${encodeURIComponent(term)}`;
  try {
    const response = await fetch(sourceUrl, { headers: { "user-agent": "司律備考法律辭典/1.0" } });
    if (!response.ok) throw new Error(`官方辭典回應 ${response.status}`);
    const lines = readableText(await response.text());
    const start = lines.findIndex((line) => line === "名詞解釋");
    const end = lines.findIndex((line) => line.includes("本解釋內容僅供參考"));
    const selected = lines
      .slice(start >= 0 ? start + 1 : 0, end > start ? end : undefined)
      .filter((line) => !/^(名詞收集|名詞查詢|對該解釋提建議)$/.test(line));
    const content = selected.join("\n").trim();
    if (!content || !content.includes(term)) return Response.json({ term, sourceUrl, error: "官方辭典查無這個名詞" }, { status: 404 });
    return Response.json({ term, content: content.slice(0, 1600), sourceUrl, sourceLabel: "司法院裁判書用語辭典" });
  } catch (error) {
    return Response.json({ term, sourceUrl, error: error instanceof Error ? error.message : "官方辭典暫時無法查詢" }, { status: 502 });
  }
}
