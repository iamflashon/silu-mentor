function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
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

function stripMarkup(html: string) {
  return readableText(html).join("\n").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLegisPediaDictionary(term: string) {
  const baseUrl = "https://www.legis-pedia.com";
  const searchUrl = `${baseUrl}/search/dictionarys?q=${encodeURIComponent(term)}`;
  const searchResponse = await fetchWithTimeout(searchUrl, {
    headers: { "user-agent": "司律備考法律辭典/1.0", accept: "text/html" },
  });
  if (!searchResponse.ok) return null;
  const searchHtml = await searchResponse.text();
  const matches = [...searchHtml.matchAll(/<a\s+href="(?:https:\/\/www\.legis-pedia\.com)?\/dictionary\/(\d+)(?:\?[^\"]*)?"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ id: match[1], title: stripMarkup(match[2]).replace(/\s+/g, "").trim() }))
    .filter((item) => item.title);
  const exact = matches.find((item) => item.title === term.replace(/\s+/g, ""));
  const candidate = exact ?? matches.find((item) => item.title.includes(term) || term.includes(item.title));
  if (!candidate) return null;

  const sourceUrl = `${baseUrl}/dictionary/${candidate.id}`;
  const pageResponse = await fetchWithTimeout(sourceUrl, {
    headers: { "user-agent": "司律備考法律辭典/1.0", accept: "text/html" },
  });
  if (!pageResponse.ok) return null;
  const pageHtml = await pageResponse.text();
  const contentMatch = pageHtml.match(/<div[^>]*class="[^"]*one-dict-content[^\"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*one-dict-refer[^"]*"/i);
  const content = contentMatch ? stripMarkup(contentMatch[1]) : stripMarkup(pageHtml);
  if (!content) return null;
  return {
    term: candidate.title,
    content: content.slice(0, 1600),
    sourceUrl,
    sourceLabel: "法律百科 Legispedia",
    sourceType: "legispedia" as const,
    sourceNote: "法律百科已公告自 2026 年 5 月 1 日停止更新，請再核對現行法令。",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const random = url.searchParams.get("random") === "1";
  const randomTerms = ["比例原則", "信賴保護", "既判力", "抗告", "正當防衛", "不真正不作為", "訴之主觀預備合併"];
  const term = (url.searchParams.get("q") ?? (random ? randomTerms[Math.floor(Math.random() * randomTerms.length)] : "")).trim().slice(0, 40);
  if (!term) return Response.json({ error: "請輸入法律名詞" }, { status: 400 });
  const sourceUrl = `https://terms.judicial.gov.tw/TermContent.aspx?SYS=V&TRMTERM=${encodeURIComponent(term)}`;
  try {
    const response = await fetchWithTimeout(sourceUrl, { headers: { "user-agent": "司律備考法律辭典/1.0" } });
    if (!response.ok) throw new Error(`官方辭典回應 ${response.status}`);
    const lines = readableText(await response.text());
    const start = lines.findIndex((line) => line === "名詞解釋");
    const end = lines.findIndex((line) => line.includes("本解釋內容僅供參考"));
    const selected = lines
      .slice(start >= 0 ? start + 1 : 0, end > start ? end : undefined)
      .filter((line) => !/^(名詞收集|名詞查詢|對該解釋提建議)$/.test(line));
    const content = selected.join("\n").trim();
    if (content && content.includes(term)) {
      return Response.json({ term, content: content.slice(0, 1600), sourceUrl, sourceLabel: "司法院裁判書用語辭典", sourceType: "judicial", sourceNote: "官方來源" });
    }
  } catch {
    // 官方詞典暫時無法連線時，仍嘗試法律百科；不可因單一來源失敗而中斷查詢。
  }

  try {
    const fallback = await fetchLegisPediaDictionary(term);
    if (fallback) return Response.json(fallback);
  } catch {
    // 兩個外部詞典都不可用時，交由前端提供 AI 白話解釋入口。
  }

  return Response.json({
    term,
    sourceUrl: "https://www.legis-pedia.com/dictionary",
    sourceLabel: "司法院／法律百科",
    canExplainWithAi: true,
    error: "目前查不到這個詞條；可以改由 AI 依法律學習脈絡說明。",
  }, { status: 404 });
}
