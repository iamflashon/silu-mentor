import { and, desc, eq, gte, inArray, like, lt, lte, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSearchUnits, documentSectionMappings, documents, judicialCases, legalArticles, legalDocuments, pengliTeacherQuestions, usageLogs } from "../../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../../lib/usage";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { requireMember } from "../../../../../lib/member-auth";
import { finishAiUse, prepareAiUse } from "../../../../../lib/ai-access-gate";
import { ensurePengliFreeTrial, getActiveAiEntitlement, getAiPlan } from "../../../../../lib/ai-access";
import { PENGLI_THEME_TITLES } from "../../../../../lib/pengli-book-toc";

type InputMessage = { role?: unknown; text?: unknown };

const PENGLI_BOOK_BODY_START_PAGE = 23;
function isPengliNavigationPage(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const dotLeaders = (normalized.match(/(?:\.{4,}|…{2,}|·{4,})/gu) ?? []).length;
  const compactPageRefs = (normalized.match(/\b\d{1,2}-\d{1,3}\b/gu) ?? []).length;
  const themeCount = PENGLI_THEME_TITLES.filter((title) => normalized.includes(title)).length;
  return /目\s*錄|contents/iu.test(normalized.slice(0, 280)) || dotLeaders >= 2 || compactPageRefs >= 5 || themeCount >= 3;
}

function isShortHelpReply(text: string) {
  return /^(?:(我)?(不知道|不會|不懂|沒想法|想不到|請提示|給我提示|可以提示嗎)|我不懂[，,、\s]*請老師(?:再)?說明(?:這題應該先從哪個判斷步驟開始)?)[。！!？?\s]*$/u.test(text.trim());
}

function isCoachArrangementRequest(text: string) {
  return /^(?:沒有(?:指定)?|沒有特別想學的|都可以|請教練安排|由教練安排|照教材(?:順序)?開始|你幫我安排)[，,、\s]*(?:請)?(?:由)?教練安排[。！!？?\s]*$/u.test(text.trim())
    || /^(?:沒有(?:指定)?|都可以)[。！!？?\s]*$/u.test(text.trim());
}

function clearlyOutsidePengliScope(text: string) {
  const normalized = text.normalize("NFKC");
  return /出師表|唐詩|宋詞|國文作文|會計分錄|折舊費用|借貸平衡|合併報表|血液檢驗|血球分類|抗原抗體|英文文法|二次方程式|微積分|Python|食譜|天氣預報|共同正犯|殺人罪|竊盜罪|刑事訴訟法/u.test(normalized);
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function outputWasTruncated(payload: Record<string, unknown>) {
  if (payload.status !== "incomplete") return false;
  const details = payload.incomplete_details;
  return Boolean(details && typeof details === "object" && (details as { reason?: unknown }).reason === "max_output_tokens");
}

function plainText(value: string) {
  return value.replace(/\*\*/gu, "").replace(/^#{1,6}\s*/gmu, "").replace(/^>\s?/gmu, "").trim();
}

function removeUnsupportedTrailingForeignText(value: string, evidenceText: string) {
  const match = value.match(/([。！？；])\s+((?:[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]{2,})(?:\s+[\p{Script=Latin}][\p{Script=Latin}\p{M}'’-]{2,}){0,3})[.!?]?\s*$/u);
  if (!match || match.index == null) return value;
  const foreignText = match[2].normalize("NFKC").toLocaleLowerCase();
  const normalizedEvidence = evidenceText.normalize("NFKC").toLocaleLowerCase();
  if (normalizedEvidence.includes(foreignText)) return value;
  return `${value.slice(0, match.index)}${match[1]}`.trim();
}

function compactVerification(value: string, maxLength = 360) {
  const cleaned = plainText(value).replace(/\n{3,}/gu, "\n\n").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const clipped = cleaned.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf("。"), clipped.lastIndexOf("；"), clipped.lastIndexOf("！"), clipped.lastIndexOf("？"));
  return `${clipped.slice(0, sentenceEnd >= 220 ? sentenceEnd + 1 : maxLength).trim()}…`;
}

const OFFICIAL_LEGAL_DOMAINS = ["law.moj.gov.tw", "moj.gov.tw", "judicial.gov.tw"];

function officialWebSources(payload: Record<string, unknown>) {
  const searched = new Map<string, { label: string; url: string; context: string }>();
  const cited = new Map<string, { label: string; url: string; context: string }>();
  const add = (target: typeof searched, title: unknown, url: unknown, context = "") => {
    const href = cleanOfficialUrl(typeof url === "string" ? url.trim() : "");
    if (!href) return;
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (!OFFICIAL_LEGAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return;
      const current = target.get(href);
      target.set(href, { label: String(title || current?.label || host).trim() || host, url: href, context: context || current?.context || "" });
    } catch { /* 忽略非網址資料 */ }
  };
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    const action = (item as { action?: { sources?: unknown[] } }).action;
    for (const source of Array.isArray(action?.sources) ? action.sources : []) {
      if (source && typeof source === "object") add(searched, (source as { title?: unknown }).title, (source as { url?: unknown }).url);
    }
    for (const content of Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []) {
      if (!content || typeof content !== "object") continue;
      const contentText = typeof (content as { text?: unknown }).text === "string" ? String((content as { text: unknown }).text) : "";
      for (const annotation of Array.isArray((content as { annotations?: unknown[] }).annotations) ? (content as { annotations: unknown[] }).annotations : []) {
        if (annotation && typeof annotation === "object" && (annotation as { type?: unknown }).type === "url_citation") {
          const start = Number((annotation as { start_index?: unknown }).start_index ?? contentText.length);
          add(cited, (annotation as { title?: unknown }).title, (annotation as { url?: unknown }).url, contentText.slice(Math.max(0, start - 220), start));
        }
      }
    }
  }
  return [...(cited.size ? cited : searched).values()].slice(0, 8);
}

type ArticleReference = { lawName: string; articleNo: string; term: string };

function exactArticleReferences(question: string, reply: string): ArticleReference[] {
  const value = `${question} ${reply}`.normalize("NFKC");
  const knownLawNames = ["行政程序法", "行政訴訟法", "行政罰法", "行政執行法", "訴願法", "國家賠償法", "政府資訊公開法", "中央法規標準法", "地方制度法"];
  const found = new Map<string, ArticleReference>();
  for (const match of value.matchAll(/([\p{Script=Han}]{2,20}(?:法|條例|通則|規則|辦法))第\s*(\d+)(?:\s*之\s*(\d+))?\s*條/gu)) {
    const rawLawName = match[1];
    const lawName = knownLawNames.find((name) => rawLawName.includes(name))
      || rawLawName.replace(/^(?:是以|始符|依據|依照|依|參照|按照|違反|適用|準用|類推|所稱|本於)+/u, "");
    const articleNo = `${match[2]}${match[3] ? `之${match[3]}` : ""}`;
    const term = `${lawName}第${articleNo}條`;
    found.set(term, { lawName, articleNo, term });
  }
  return [...found.values()];
}

function verificationTerms(question: string, reply: string) {
  const articleReferences = exactArticleReferences(question, reply).map((reference) => reference.term);
  const exact = `${question} ${reply}`.normalize("NFKC").match(/(?:釋字|憲判字)第?\s*\d+\s*號|\d{2,3}年度[^，。；：\s]{1,10}字第\s*\d+\s*號/gu) ?? [];
  const stop = /^(老師|回答|問題|是否|可以|認為|規定|資料|法律|行政法|查證|說明|內容|學生|目前|如果|因為|本題|官方)$/u;
  const words = question.normalize("NFKC").split(/[\s、，。；：,.;:()（）？?！!「」『』]+/u)
    .map((term) => term.trim()).filter((term) => term.length >= 2 && term.length <= 14 && !stop.test(term));
  return [...new Set([...articleReferences, ...exact, ...words])].slice(0, 3);
}

function sourceMatchesExplicitReferences(source: { label: string; url: string; context?: string }, articles: ArticleReference[], cases: string[]) {
  if (!articles.length && !cases.length) return true;
  const searchable = `${source.label} ${source.context || ""} ${decodeURIComponent(source.url)}`.normalize("NFKC").replace(/\s+/gu, "");
  if (cases.some((caseNo) => searchable.includes(caseNo.replace(/\s+/gu, "")))) return true;
  return articles.some(({ lawName, articleNo, term }) => {
    if (searchable.includes(term.replace(/\s+/gu, ""))) return true;
    try {
      const url = new URL(source.url);
      const linkedArticle = url.searchParams.get("flno") || url.searchParams.get("lawNumber") || url.searchParams.get("LawNo");
      const sameArticle = linkedArticle?.replace(/\s+/gu, "") === articleNo.replace(/之/gu, "-");
      const knownAdministrativeProcedureLaw = lawName === "行政程序法" && url.searchParams.get("pcode")?.toUpperCase() === "A0030055";
      return Boolean(sameArticle && (knownAdministrativeProcedureLaw || searchable.includes(lawName)));
    } catch { return false; }
  });
}

function isInterpretiveTeachingClaim(value: string) {
  return /(?:本頁|本書|教材|老師|學說|見解|目的性限縮|旨趣|立法目的|信賴保護|應僅以|應限於|解釋上)/u.test(value);
}

function onlyBareStatuteSources(sources: { label: string; url: string }[]) {
  return sources.length > 0 && sources.every((source) => {
    try { return new URL(source.url).hostname.toLowerCase() === "law.moj.gov.tw"; }
    catch { return false; }
  });
}

function exactCaseReferences(question: string, reply: string) {
  return [...new Set((`${question} ${reply}`.normalize("NFKC").match(/\d{2,3}年度[^，。；：\s]{1,12}字第\s*\d+\s*號/gu) ?? [])
    .map((value) => value.replace(/\s+/gu, "")))];
}

function judicialOfficialUrl(jid: string) {
  return jid ? `https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=${encodeURIComponent(jid)}` : "";
}

function officialAgencyName(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "cons.judicial.gov.tw" || host.endsWith(".cons.judicial.gov.tw")) return "憲法法庭";
    if (host === "judicial.gov.tw" || host.endsWith(".judicial.gov.tw")) return "司法院";
    if (host === "law.moj.gov.tw" || host.endsWith(".law.moj.gov.tw")) return "全國法規資料庫";
    if (host === "moj.gov.tw" || host.endsWith(".moj.gov.tw")) return "法務部";
  } catch { /* 保留無法解析的來源名稱 */ }
  return "官方資料";
}

function cleanOfficialUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    return url.toString();
  } catch { return value; }
}

function sourceTitleFromContext(value: string) {
  const matches = value.normalize("NFKC").match(/(?:司法院)?釋字第\s*\d+\s*號|憲法法庭\s*\d+\s*年憲判字第\s*\d+\s*號|(?:最高)?行政法院\s*\d{2,3}\s*年度[^，。；：\s]{1,12}字第\s*\d+\s*號(?:判決|裁定)?|[\p{Script=Han}]{1,16}法第\s*\d+(?:[-之]\d+)?\s*條/gu) ?? [];
  return matches.at(-1)?.replace(/\s+/gu, "") ?? "";
}

function fallbackSourceTitle(value: string) {
  try {
    const url = new URL(value);
    const fileName = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    if (/\.pdf$/iu.test(fileName)) return fileName.replace(/\.pdf$/iu, "");
    const documentId = url.searchParams.get("id");
    if (/\/download(?:\/|\.aspx)/iu.test(url.pathname) && documentId) return `PDF 文件（文件編號 ${documentId}）`;
    const judgmentId = url.searchParams.get("id");
    if (/judgment\.judicial\.gov\.tw$/iu.test(url.hostname) && judgmentId) return `裁判原文（${decodeURIComponent(judgmentId)}）`;
  } catch { /* 使用通用名稱 */ }
  return "官方資料頁面";
}

function humanSourceTitle(label: string, url: string, context = "") {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./u, ""); } catch { /* 使用原標籤 */ }
  const trimmed = label.trim();
  const generic = !trimmed || trimmed === host || trimmed === `www.${host}` || /^https?:\/\//iu.test(trimmed);
  return generic ? sourceTitleFromContext(context) || fallbackSourceTitle(url) : trimmed;
}

function localizeOfficialCitations(value: string) {
  return value
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gu, (_match, label: string, url: string, offset: number) => `（來源：${officialAgencyName(url)}｜${humanSourceTitle(label, url, value.slice(Math.max(0, offset - 180), offset))}）`)
    .replace(/\((https?:\/\/[^)\s]+)\)/gu, (_match, url: string, offset: number) => `（來源：${officialAgencyName(url)}｜${humanSourceTitle("", url, value.slice(Math.max(0, offset - 180), offset))}）`);
}

function localizedSource(source: { label: string; url: string; excerpt: string; context?: string }) {
  const url = cleanOfficialUrl(source.url);
  const agency = officialAgencyName(url);
  const title = humanSourceTitle(source.label, url, source.context);
  const { context: _context, ...rest } = source;
  return { ...rest, url, label: title.startsWith(agency) ? title : `${agency}｜${title}` };
}


type PengliLegalAnalysis = {
  kind: string;
  officialName: string;
  legalField: string;
  nature: string;
  reference: string;
  points: string[];
  verification: string;
  caveat: string;
};

type PengliPlainExplanation = {
  explanation: string;
  notePoints: string[];
  analysis: PengliLegalAnalysis;
};

const pengliPlainResponseFormat = {
  type: "json_schema",
  name: "pengli_legal_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          officialName: { type: "string" },
          legalField: { type: "string" },
          nature: { type: "string" },
          reference: { type: "string" },
          points: { type: "array", items: { type: "string" } },
          verification: { type: "string" },
          caveat: { type: "string" },
        },
        required: ["kind", "officialName", "legalField", "nature", "reference", "points", "verification", "caveat"],
      },
      explanation: { type: "string" },
      notePoints: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    },
    required: ["analysis", "explanation", "notePoints"],
  },
};

const pengliScholarFollowUpFormat = {
  type: "json_schema",
  name: "pengli_scholar_follow_up",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      question: { type: "string" },
    },
    required: ["answer", "question"],
  },
};

type PengliTopicGuide = {
  summary: string;
  keyPoints: string[];
  firstPoint: string;
};

const pengliTopicGuideFormat = {
  type: "json_schema",
  name: "pengli_topic_guide",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      keyPoints: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
      firstPoint: { type: "string" },
    },
    required: ["summary", "keyPoints", "firstPoint"],
  },
};

function parseTopicGuide(text: string): PengliTopicGuide | null {
  try {
    const value = JSON.parse(text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim()) as Partial<PengliTopicGuide>;
    const keyPoints = Array.isArray(value.keyPoints)
      ? [...new Set(value.keyPoints.map((item) => cleanTopicPoint(String(item))).filter(isSemanticTopicPoint))].slice(0, 5)
      : [];
    const summary = plainText(String(value.summary ?? "")).trim();
    const firstPoint = cleanTopicPoint(String(value.firstPoint ?? ""));
    if (keyPoints.length < 3 || summary.length < 12 || containsPageReference(summary) || !keyPoints.includes(firstPoint)) return null;
    return { summary, keyPoints, firstPoint };
  } catch {
    return null;
  }
}

function cleanTopicPoint(value: string) {
  return plainText(value).normalize("NFKC")
    .replace(/^[\s\-‐‑‒–—―_─━═=·•．…]+|[\s\-‐‑‒–—―_─━═=·•．…]+$/gu, "")
    .trim();
}

function containsPageReference(value: string) {
  const normalized = value.normalize("NFKC").trim();
  return /\bPDF\b|頁碼|\d+\s*(?:[-–—至到]\s*\d+\s*)?頁|^\s*\d+\s*$/iu.test(normalized);
}

function isBibliographicReference(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const citationSignals = [/[，,]/u, /\d+\s*版/u, /\d{4}\s*年/u, /\d+\s*月/u, /\d+\s*頁/u, /(?:著|編|譯|總論|專論)/u]
    .filter((pattern) => pattern.test(normalized)).length;
  return citationSignals >= 3;
}

function isSemanticTopicPoint(value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 4 || normalized.length > 36 || containsPageReference(normalized) || isBibliographicReference(normalized)) return false;
  return !/^(?:教材(?:內容|片段|重點|範圍)?|本章(?:內容|重點)?|章節(?:內容|重點)?|主題[一二三四五六七八九十\d]+|概說|問題意識|學說見解|實務見解|考點破解|擬答|行政法考點|行政處分)$/u.test(normalized);
}

function fallbackTopicGuide(topic: string, rows: { hierarchyPath: string; title: string; text: string }[]): PengliTopicGuide | null {
  const labels = rows.flatMap((row) => `${row.hierarchyPath}｜${row.title}`.split(/[>／/｜]/u))
    .map((item) => cleanTopicPoint(item.replace(/^\s*(?:考點\s*\d+[：:]?|第[一二三四五六七八九十\d]+節[：:]?)\s*/u, "")))
    .filter((item) => item !== topic && isSemanticTopicPoint(item));
  const enumerated = rows.flatMap((row) => [...row.text.matchAll(/[一二三四五六七八九十]\s*[、.)）]\s*([^，。；：\n]{4,30})/gu)]
    .map((match) => cleanTopicPoint(match[1])).filter(isSemanticTopicPoint));
  const keyPoints = [...new Set([...labels, ...enumerated])].slice(0, 5);
  if (keyPoints.length < 3) return null;
  return {
    summary: `以下重點均取自彭狸老師「${topic}」章節目前命中的教材內容。`,
    keyPoints,
    firstPoint: keyPoints[0],
  };
}

function parseScholarFollowUp(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  try {
    const value = JSON.parse(cleaned) as { answer?: unknown; question?: unknown };
    const answer = plainText(typeof value.answer === "string" ? value.answer : "").trim();
    let question = plainText(typeof value.question === "string" ? value.question : "").trim();
    if (question && !/[？?]$/u.test(question)) question = `${question}？`;
    if (answer.length < 24 || question.length < 10) return null;
    return { answer, question };
  } catch {
    return null;
  }
}

function parsePengliPlainExplanation(text: string): PengliPlainExplanation | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const value = JSON.parse(cleaned) as { explanation?: unknown; notePoints?: unknown; analysis?: Partial<PengliLegalAnalysis> };
    if (typeof value.explanation !== "string" || !value.explanation.trim() || !value.analysis || typeof value.analysis !== "object" || Array.isArray(value.analysis)) return null;
    const notePoints = Array.isArray(value.notePoints) ? value.notePoints.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3) : [];
    const points = Array.isArray(value.analysis.points) ? value.analysis.points.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    if (notePoints.length !== 3) return null;
    return {
      explanation: value.explanation.trim(),
      notePoints,
      analysis: {
        kind: String(value.analysis.kind ?? ""),
        officialName: String(value.analysis.officialName ?? ""),
        legalField: String(value.analysis.legalField ?? ""),
        nature: String(value.analysis.nature ?? ""),
        reference: String(value.analysis.reference ?? ""),
        points,
        verification: String(value.analysis.verification ?? ""),
        caveat: String(value.analysis.caveat ?? ""),
      },
    };
  } catch {
    return null;
  }
}

function coachParts(value: string) {
  const cleaned = plainText(value);
  const marker = cleaned.match(/【學霸追問】/u);
  return {
    coach: plainText(cleaned.replace(/【教練回應】/gu, "").slice(0, marker?.index ?? cleaned.length)),
    scholar: marker ? plainText(cleaned.slice((marker.index ?? 0) + marker[0].length)) : "",
  };
}

async function pengliEvidence(query: string, scopeTopic = "", pageHint = 0, preferredDocumentId = 0) {
  const empty = (searchFailed = false) => ({
    documentId: null as number | null,
    title: "",
    rows: [] as Array<{ pageStart: number | null; pageEnd: number | null; title: string; hierarchyPath: string; text: string }>,
    themeStartPage: null as number | null,
    themeEndPage: null as number | null,
    requestedPage: 0,
    bookPageLabel: "",
    navigationPage: false,
    sourceMode: "index" as "index" | "private_pdf_page",
    pageStatus: "unknown" as "confirmed" | "unknown" | "outside",
    searchFailed,
  });
  try {
  const db = await getDb("primary");
  const directBooks = await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName, storageKey: documents.storageKey })
    .from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%")))
    .orderBy(desc(documents.id)).limit(10);
  const assignedBooks = await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName, storageKey: documents.storageKey })
    .from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true)))
    .orderBy(desc(documents.id)).limit(10);
  const books = [...new Map([...assignedBooks, ...directBooks].map((book) => [book.id, book])).values()];
  if (!books.length) return empty();

  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-Hant");
  const normalizedScope = scopeTopic.normalize("NFKC").toLocaleLowerCase("zh-Hant");
  const scopeThemeIndex = normalizedScope ? PENGLI_THEME_TITLES.findIndex((title) => normalizedScope.includes(title.toLocaleLowerCase("zh-Hant")) || title.toLocaleLowerCase("zh-Hant").includes(normalizedScope)) : -1;
  const printedMatch = normalized.match(/(?:書(?:本|內)?\s*)?第?\s*([1-8])\s*[-－—之]\s*(\d{1,3})\s*頁?/u);
  const themePageMatch = normalized.match(/主題\s*([1-8])\s*(?:的)?\s*第?\s*(\d{1,3})\s*頁/u);
  const explicitPdfPage = Number(normalized.match(/pdf\s*第?\s*(\d{1,4})\s*頁/u)?.[1] || 0);
  const ordinaryPage = Number(normalized.match(/第\s*(\d{1,4})\s*頁/u)?.[1] || 0);
  let requestedPage = Number(pageHint || explicitPdfPage || 0);
  let bookPageLabel = "";
  let requestedMapping: typeof documentSectionMappings.$inferSelect | undefined;
  if (!requestedPage && (themePageMatch || printedMatch)) {
    const matchedBookPage = themePageMatch || printedMatch;
    const themeNumber = Number(matchedBookPage?.[1]), localPage = Number(matchedBookPage?.[2]);
    [requestedMapping] = await db.select().from(documentSectionMappings).where(and(
      inArray(documentSectionMappings.documentId, books.map((book) => book.id)),
      eq(documentSectionMappings.sectionKey, `theme_${themeNumber}`),
      eq(documentSectionMappings.verified, true),
    )).limit(1);
    if (requestedMapping) { requestedPage = requestedMapping.pdfStartPage + localPage - 1; bookPageLabel = `${themeNumber}-${localPage}`; }
  } else if (!requestedPage && ordinaryPage && scopeThemeIndex >= 0) {
    [requestedMapping] = await db.select().from(documentSectionMappings).where(and(
      inArray(documentSectionMappings.documentId, books.map((book) => book.id)),
      eq(documentSectionMappings.sectionKey, `theme_${scopeThemeIndex + 1}`),
      eq(documentSectionMappings.verified, true),
    )).limit(1);
    if (requestedMapping) { requestedPage = requestedMapping.pdfStartPage + ordinaryPage - 1; bookPageLabel = `${scopeThemeIndex + 1}-${ordinaryPage}`; }
    else requestedPage = ordinaryPage;
  } else if (!requestedPage && ordinaryPage) requestedPage = ordinaryPage;
  if (requestedPage > 0 && !bookPageLabel) {
    [requestedMapping] = await db.select().from(documentSectionMappings).where(and(
      inArray(documentSectionMappings.documentId, books.map((book) => book.id)),
      eq(documentSectionMappings.verified, true),
      lte(documentSectionMappings.pdfStartPage, requestedPage),
      gte(documentSectionMappings.pdfEndPage, requestedPage),
    )).limit(1);
    if (requestedMapping?.sectionType === "body") bookPageLabel = `${requestedMapping.sortOrder}-${requestedPage - requestedMapping.pdfStartPage + 1}`;
  }
  if (requestedMapping && (requestedPage < requestedMapping.pdfStartPage || requestedPage > requestedMapping.pdfEndPage)) return { ...empty(), requestedPage, bookPageLabel, pageStatus: "outside" as const };
  if (requestedPage > 0) {
    const orderedSourceBooks = [...books].sort((left, right) => {
      if (preferredDocumentId && left.id !== right.id) return left.id === preferredDocumentId ? -1 : right.id === preferredDocumentId ? 1 : 0;
      if (requestedMapping && left.id !== right.id) return left.id === requestedMapping.documentId ? -1 : right.id === requestedMapping.documentId ? 1 : 0;
      const leftScore = /59ML170502|行政法考點/iu.test(`${left.fileName} ${left.title}`) ? 1 : 0;
      const rightScore = /59ML170502|行政法考點/iu.test(`${right.fileName} ${right.title}`) ? 1 : 0;
      return rightScore - leftScore || right.id - left.id;
    });
    const sourceBooks = preferredDocumentId
      ? orderedSourceBooks.filter((book) => book.id === preferredDocumentId)
      : orderedSourceBooks;
    const { env } = await import("cloudflare:workers");
    let highestIndexedPage = 0;
    for (const book of sourceBooks) {
      if (!/\.local-index\.jsonl$/iu.test(book.fileName) || !book.storageKey) continue;
      const object = await env.BUCKET?.get(book.storageKey);
      if (!object) continue;
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(await object.arrayBuffer()).replace(/^\uFEFF/u, "");
      for (const [index, line] of raw.split(/\r?\n/u).entries()) {
        try {
          const record = JSON.parse(line) as { page_start?: unknown; page_end?: unknown; title?: unknown; hierarchy_path?: unknown; text?: unknown };
          const pageStart = Number(record.page_start) || index + 1;
          const pageEnd = Number(record.page_end) || pageStart;
          highestIndexedPage = Math.max(highestIndexedPage, pageEnd);
          if (requestedPage < pageStart || requestedPage > pageEnd || typeof record.text !== "string") continue;
          const text = record.text.replace(/\\n/gu, "\n").trim();
          if (!text) continue;
          // 精準指定頁已由後台主題範圍與原始逐頁檔共同定位。正文中常有大量
          // 裁判字號、條號與書頁交互引用，不能再以「頁碼很多」推定為目錄。
          if (requestedPage < PENGLI_BOOK_BODY_START_PAGE) return {
            ...empty(),
            requestedPage,
            bookPageLabel,
            navigationPage: true,
            sourceMode: "private_pdf_page" as const,
            pageStatus: "confirmed" as const,
          };
          return {
            documentId: book.id,
            title: book.title || book.fileName || "行政法考點演習書（二版）｜彭狸",
            rows: [{ pageStart: requestedPage, pageEnd: requestedPage, title: String(record.title ?? ""), hierarchyPath: String(record.hierarchy_path ?? record.title ?? ""), text }],
            themeStartPage: null,
            themeEndPage: null,
            requestedPage,
            bookPageLabel,
            navigationPage: false,
            sourceMode: "private_pdf_page" as const,
            pageStatus: "confirmed" as const,
            searchFailed: false,
          };
        } catch { /* 略過無法解析的原始頁面列 */ }
      }
    }
    return {
      ...empty(),
      requestedPage,
      bookPageLabel,
      sourceMode: "private_pdf_page" as const,
      pageStatus: highestIndexedPage > 0 && requestedPage > highestIndexedPage ? "outside" as const : "unknown" as const,
    };
  }
  const themeHints = [
    ["行政法理論基礎與行政組織法", /行政法理論基礎|行政組織法|原理原則/u, ["行政組織法", "原理原則"]],
    ["行政處分", /行政處分/u, ["行政處分"]],
    ["行政契約與行政命令", /行政契約|行政命令/u, ["行政契約", "行政命令"]],
    ["行政罰法", /行政罰法|行政罰/u, ["行政罰法", "行政罰"]],
    ["行政執行法", /行政執行法|行政執行/u, ["行政執行法", "行政執行"]],
    ["訴願法與行政訴訟法", /訴願法|行政訴訟法|訴願|行政訴訟/u, ["訴願法", "行政訴訟法"]],
    ["國家賠償法與損失補償", /國家賠償法|損失補償|國家賠償/u, ["國家賠償法", "損失補償"]],
    ["新進實務見解整理", /新進實務|實務見解/u, ["新進實務見解整理", "實務見解"]],
  ] as const;
  const matchedTheme = themeHints.find(([, pattern]) => pattern.test(normalizedScope)) ?? themeHints.find(([, pattern]) => pattern.test(normalized));
  const themeTitleList = themeHints.map(([title]) => title);
  async function findThemeStart(title: string) {
    const rows = await db.select({ pageStart: documentSearchUnits.pageStart, text: documentSearchUnits.text })
      .from(documentSearchUnits)
      .where(and(
        inArray(documentSearchUnits.documentId, books.map((book) => book.id)),
        like(documentSearchUnits.normalizedText, `%${title.toLocaleLowerCase("zh-Hant")}%`),
      )).limit(40);
    return rows.filter((row): row is { pageStart: number; text: string } => row.pageStart != null && row.pageStart >= PENGLI_BOOK_BODY_START_PAGE && !isPengliNavigationPage(row.text)).sort((left, right) => {
      const leftOtherThemes = themeTitleList.filter((item) => left.text.includes(item)).length;
      const rightOtherThemes = themeTitleList.filter((item) => right.text.includes(item)).length;
      const leftOpening = left.text.slice(0, 220).includes(title) ? 0 : 1;
      const rightOpening = right.text.slice(0, 220).includes(title) ? 0 : 1;
      return leftOtherThemes - rightOtherThemes || leftOpening - rightOpening || left.pageStart - right.pageStart;
    })[0]?.pageStart ?? null;
  }
  const selectedThemeIndex = matchedTheme ? themeTitleList.indexOf(matchedTheme[0]) : -1;
  const [verifiedMapping] = selectedThemeIndex >= 0 && normalizedScope ? await db.select().from(documentSectionMappings).where(and(
    inArray(documentSectionMappings.documentId, books.map((book) => book.id)),
    eq(documentSectionMappings.sectionKey, `theme_${selectedThemeIndex + 1}`),
    eq(documentSectionMappings.verified, true),
  )).limit(1) : [];
  const themeStartPage = verifiedMapping?.pdfStartPage || (selectedThemeIndex >= 0 && normalizedScope ? await findThemeStart(themeTitleList[selectedThemeIndex]) : null);
  const nextThemeStartPage = verifiedMapping?.pdfEndPage ? verifiedMapping.pdfEndPage + 1 : selectedThemeIndex >= 0 && selectedThemeIndex < themeTitleList.length - 1 && normalizedScope ? await findThemeStart(themeTitleList[selectedThemeIndex + 1]) : null;
  const legalPhrases = [
    "禁止繼續使用擴音設施", "繼續使用擴音設施", "擴音設施", "噪音管制法",
    "行政法上請求權", "公法上請求權", "課予義務訴訟", "一般給付訴訟",
    "訴訟類型", "救濟程序", "行政處分", "請求權基礎", "公私法區分",
    "法律保留原則", "層級化法律保留", "明確性原則", "外部性",
  ].filter((phrase) => normalized.includes(phrase));
  const topicHints: string[] = [];
  if (matchedTheme) topicHints.push(matchedTheme[0], ...matchedTheme[2]);
  if (/擴音|噪音|禁止繼續使用/u.test(normalized)) topicHints.push("禁止繼續使用擴音設施", "行政法上請求權", "訴訟類型", "課予義務訴訟");
  if (/公私法|請求權基礎|758/u.test(normalized)) topicHints.push("公私法區分", "請求權基礎", "新主體說", "758");
  if (/法律保留|443/u.test(normalized)) topicHints.push("法律保留原則", "層級化法律保留", "443");
  if (/明確性/u.test(normalized)) topicHints.push("明確性原則", "可理解", "可預見", "司法審查");
  if (/行政處分|外部性/u.test(normalized)) topicHints.push("行政處分", "外部性");
  const quotedPhrases = [...normalized.matchAll(/[「『]([^」』]{4,36})[」』]/gu)].map((match) => match[1].trim());
  const longPhraseWindows = (normalized.match(/[\p{Script=Han}]{4,}/gu) ?? []).flatMap((phrase) => {
    if (phrase.length <= 28) return [phrase];
    const windows: string[] = [];
    for (let index = 0; index < phrase.length; index += 6) {
      const window = phrase.slice(index, index + 22);
      if (window.length >= 8) windows.push(window);
    }
    return windows;
  });
  const terms = [...new Set([
    ...quotedPhrases,
    ...longPhraseWindows,
    ...legalPhrases,
    ...normalized.split(/[\s、，。；：,.;:()（）？?！!「」『』]+/u)
      .map((term) => term.replace(/^(我正在學|請先用|一個問題|帶我判斷|請問|老師)/u, "").trim())
      .filter((term) => term.length >= 2 && term.length <= 28),
    ...topicHints,
  ])].slice(0, 10);
  // D1 查詢只使用少量核心詞，避免學霸代答把整段對話展開成過長的 OR 條件。
  const conditions = terms.map((term) => or(
    like(documentSearchUnits.normalizedText, `%${term}%`),
    like(documentSearchUnits.text, `%${term}%`),
  ));
  const pageCondition = requestedPage > 0
    ? or(
        eq(documentSearchUnits.pageStart, requestedPage),
        and(lte(documentSearchUnits.pageStart, requestedPage), gte(documentSearchUnits.pageEnd, requestedPage)),
      )
    : undefined;
  const themeCondition = !pageCondition && themeStartPage
    ? nextThemeStartPage
      ? and(gte(documentSearchUnits.pageStart, themeStartPage), lt(documentSearchUnits.pageStart, nextThemeStartPage))
      : gte(documentSearchUnits.pageStart, themeStartPage)
    : undefined;
  let candidates = (pageCondition || conditions.length) ? await db.select({
    documentId: documentSearchUnits.documentId,
    pageStart: documentSearchUnits.pageStart,
    pageEnd: documentSearchUnits.pageEnd,
    title: documentSearchUnits.title,
    hierarchyPath: documentSearchUnits.hierarchyPath,
    text: documentSearchUnits.text,
  }).from(documentSearchUnits)
    .where(and(
      inArray(documentSearchUnits.documentId, books.map((book) => book.id)),
      pageCondition ?? and(themeCondition, or(...conditions)),
    ))
    .orderBy(documentSearchUnits.sequence).limit(60) : [];
  if (!candidates.length && themeCondition && conditions.length) {
    candidates = await db.select({
      documentId: documentSearchUnits.documentId,
      pageStart: documentSearchUnits.pageStart,
      pageEnd: documentSearchUnits.pageEnd,
      title: documentSearchUnits.title,
      hierarchyPath: documentSearchUnits.hierarchyPath,
      text: documentSearchUnits.text,
    }).from(documentSearchUnits)
      .where(and(
        inArray(documentSearchUnits.documentId, books.map((book) => book.id)),
        or(...conditions),
      ))
      .orderBy(documentSearchUnits.sequence).limit(60);
  }
  const rows = candidates
    .map((row) => {
      const haystack = `${row.title} ${row.hierarchyPath} ${row.text}`.normalize("NFKC").toLocaleLowerCase("zh-Hant");
      const themeTitle = matchedTheme?.[0] ?? "";
      const heading = `${row.title} ${row.hierarchyPath}`.normalize("NFKC").toLocaleLowerCase("zh-Hant");
      const opening = row.text.slice(0, 260).normalize("NFKC").toLocaleLowerCase("zh-Hant");
      const normalizedText = row.text.normalize("NFKC").toLocaleLowerCase("zh-Hant");
      const otherThemeCount = themeTitleList.filter((item) => normalizedText.includes(item.toLocaleLowerCase("zh-Hant"))).length;
      const navigationPenalty = /目錄|contents/iu.test(row.text) ? 240 : Math.max(0, otherThemeCount - 1) * 90;
      const score = (requestedPage > 0 && row.pageStart === requestedPage ? 200 : 0)
        + terms.reduce((total, term, index) => total + (normalizedText.includes(term) ? Math.max(4, 40 - index * 3) + Math.min(term.length, 28) * 2 : haystack.includes(term) ? 2 : 0), 0)
        + quotedPhrases.reduce((total, phrase) => total + (normalizedText.includes(phrase) ? 180 + phrase.length * 4 : 0), 0)
        + (themeTitle && heading.includes(themeTitle) ? 12 : 0)
        + (themeTitle && opening.includes(themeTitle) ? 8 : 0)
        - navigationPenalty;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score || (a.row.pageStart ?? 9999) - (b.row.pageStart ?? 9999))
    .slice(0, 6)
    .map(({ row: { documentId: _documentId, ...row } }) => row);
  const matchedBook = books.find((book) => book.id === candidates[0]?.documentId) ?? books[0];
  return { documentId: matchedBook.id, title: matchedBook.title || matchedBook.fileName || "行政法考點演習書（二版）｜彭狸", rows, themeStartPage, themeEndPage: nextThemeStartPage ? nextThemeStartPage - 1 : null, requestedPage: 0, bookPageLabel: "", navigationPage: false, sourceMode: "index" as const, pageStatus: rows.length > 0 && rows.every((row) => row.pageStart != null) ? "confirmed" as const : "unknown" as const, searchFailed: false };
  } catch (error) {
    console.error("Pengli evidence lookup failed", error);
    return empty(true);
  }
}

const teacherContext = `
【專屬教材】彭狸，《行政法考點（考前衝刺）演習書》，2026年二版。
【目錄層級】全書依「主題 → 部（不一定有）→ 子部（不一定有）→ 考點 → 考點直擊站（可能有多題）」編排。考點編號可能在不同部重新起算；不得只憑考點號碼判斷位置。
【正文結構】「概說、問題意識、學說見解、實務見解、考點破解、擬答」是正文中可能出現的內容類型，不是每個考點都有的固定欄位。只有本輪原文明確出現時才能引用，不得補造缺少的段落。
【本書學習方法】本書以「爭點＋解題」協助已有行政法基礎的學生考前複習。先建立問題意識，理解爭議為何發生；再整理實務與學說及其理由；接著用考點直擊站辨認老師如何包裝爭點；最後依考點破解整理答題順序與涵攝。
【行政法解題總脈絡】若題目審查行政行為，先定性，再審查合法性，最後處理救濟；若題目詢問得否請求，先找請求權基礎，再處理如何請求與救濟。申論作答應重視本文見解、本案涵攝、邏輯及層次，但不得在教材原文不足時自行生成完整擬答。
`;

export async function GET(request: Request) {
  const auth = await requireMember(request);
  if ("error" in auth) return auth.error;
  const params = new URL(request.url).searchParams;
  const topic = params.get("topic")?.trim().slice(0, 120) ?? "";
  if (!topic) return Response.json({ error: "請提供主題名稱。" }, { status: 400 });
  const evidence = await pengliEvidence(topic, topic);
  const first = evidence.rows.find((row) => row.pageStart != null);
  if (!first) return Response.json({ topic, located: false });
  let guide = fallbackTopicGuide(topic, evidence.rows);
  if (await getOpenAIKey()) {
    const excerpts = evidence.rows.slice(0, 6).map((row, index) => `【教材正文片段 ${index + 1}】\n${row.text.replace(/\s+/gu, " ").slice(0, 900)}`).join("\n\n");
    try {
      const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions: `你是教材編輯，只能依提供的彭狸老師教材正文整理「${topic}」的學習導覽，不得加入模型一般知識、外部法條或正文未出現的概念。學生可能沒有帶書，所以每個選項單獨看就必須知道會學到哪一個法律概念或爭點。summary 用一句話說明本章教材的實際學習範圍；keyPoints 列出 3 至 5 個正文明確出現、可以直接開始教學的具體法律內容，每點 6 至 24 字並沿用教材用語。正文中的作者、書名、版次、出版年月及頁數屬於參考文獻，不是學習重點，絕對不得列入 keyPoints。也嚴禁把 PDF、頁碼、章節位置、教材片段編號或「基本概念」「核心爭點」等空泛詞當作 keyPoint，且不得在 summary 中列頁碼或參考文獻。firstPoint 必須逐字選自 keyPoints，並選最適合先學的前置重點。`,
        input: excerpts,
        text: { format: pengliTopicGuideFormat },
        max_output_tokens: 500,
      }) }) as Record<string, unknown>;
      guide = parseTopicGuide(outputText(payload)) ?? guide;
    } catch (error) {
      console.error("Pengli topic guide generation failed", error);
    }
  }
  return Response.json({
    topic,
    located: true,
    pageStart: evidence.themeStartPage ?? first.pageStart,
    pageEnd: evidence.themeEndPage ?? first.pageEnd,
    source: evidence.title,
    guide,
  });
}

export async function POST(request: Request) {
  try {
    const auth = await requireMember(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { messages?: InputMessage[]; selectedText?: string; requestKey?: string; mode?: "scholar-assist" | "scholar-follow-up" | "plain-explain" | "verify-doubt" | "official-answer"; allowAiFallback?: boolean; messageKey?: string; aiReply?: string; sourceLabel?: string; studentQuestion?: string; topic?: string; conversationKey?: string; pageHint?: number; testDocumentId?: number; testAnswerAnchor?: string; testIssueTitle?: string; testBodyRole?: string; testSourceExcerpt?: string; testContinuation?: boolean; boundaryTest?: boolean; boundaryQuestion?: string };
    if ((body.mode === "scholar-assist" || body.mode === "scholar-follow-up") && !(await getAiPlan(auth.db)).scholarAssistEnabled) {
      return Response.json({ error: "學霸幫我回答目前未開放。", code: "SCHOLAR_ASSIST_DISABLED" }, { status: 403 });
    }
    const requestedTopic = String(body.topic ?? "").trim();
    if (!auth.member.canAdmin && requestedTopic) {
      const trial = await ensurePengliFreeTrial(auth.db, auth.member.id, requestedTopic);
      if (!trial.ok && trial.code === "TRIAL_TOPIC_MISMATCH") {
        return Response.json({ error: `免費 10 次已選定「${trial.topic}」。如要練其他主題，請購買或兌換使用次數。`, code: trial.code, selectedTopic: trial.topic, purchaseUrl: "/teachers/pengli/ai-access" }, { status: 409 });
      }
      if (!trial.ok) return Response.json({ error: "免費主題啟用失敗，請重新整理後再試。", code: trial.code }, { status: 409 });
    }
    const gate = await prepareAiUse(request, "pengli");
    if (gate instanceof Response) return gate;
    if (!await getOpenAIKey()) return Response.json({ error: "彭狸 AI 教練尚未設定模型。" }, { status: 503 });

    if (body.mode === "verify-doubt" || body.mode === "official-answer") {
      if (gate.metered && gate.memberId) {
        const entitlement = await getActiveAiEntitlement(gate.db, gate.memberId);
        const remaining = entitlement ? entitlement.quotaTotal - entitlement.quotaUsed : 0;
        if (remaining < 2) return Response.json({ error: "AI 使用次數不足；官方資料查證需要 2 次。", code: "AI_ACCESS_INSUFFICIENT", purchaseUrl: "/teachers/pengli/ai-access" }, { status: 402 });
      }
      const aiReply = String(body.aiReply ?? "").trim().slice(0, 6000);
      const sourceLabel = String(body.sourceLabel ?? "").trim().slice(0, 300);
      const studentQuestion = String(body.studentQuestion ?? "").trim().slice(0, 2000);
      if (!aiReply || !studentQuestion) return Response.json({ error: "請先選擇 AI 回覆並輸入你的疑問。" }, { status: 400 });
      const terms = verificationTerms(studentQuestion, aiReply);
      const articleReferences = exactArticleReferences(studentQuestion, aiReply);
      const exactCases = exactCaseReferences(studentQuestion, aiReply);
      const articleConditions = articleReferences.length
        ? articleReferences.map((reference) => and(like(legalDocuments.title, `%${reference.lawName}%`), like(legalArticles.articleNo, `%${reference.articleNo}%`)))
        : terms.map((term) => or(like(legalDocuments.title, `%${term}%`), like(legalArticles.content, `%${term}%`)));
      const caseTerms = exactCases.length ? exactCases : terms.slice(0, 2);
      const caseConditions = caseTerms.map((term) => or(like(judicialCases.title, `%${term}%`), like(judicialCases.caseNo, `%${term}%`)));
      let platformLookupFailed = false;
      let sources: { label: string; url: string; excerpt: string }[] = [];
      try {
        const articles = articleConditions.length ? await auth.db.select({ title: legalDocuments.title, articleNo: legalArticles.articleNo, content: legalArticles.content, sourceUrl: legalDocuments.sourceUrl }).from(legalArticles).innerJoin(legalDocuments, eq(legalArticles.documentId, legalDocuments.id)).where(or(...articleConditions)).limit(5) : [];
        const cases = caseConditions.length ? await auth.db.select({ jid: judicialCases.jid, court: judicialCases.court, judgmentDate: judicialCases.judgmentDate, title: judicialCases.title, caseNo: judicialCases.caseNo, content: judicialCases.fullText }).from(judicialCases).where(and(eq(judicialCases.status, "active"), or(...caseConditions))).limit(exactCases.length ? 1 : 2) : [];
        sources = [
          ...articles.map((row) => ({ label: `${row.title} ${row.articleNo}`, url: row.sourceUrl, excerpt: row.content.slice(0, 420) })),
          ...cases.map((row) => ({
            label: [row.court, row.caseNo, row.judgmentDate ? `（${row.judgmentDate}）` : "", row.title ? `｜${row.title}` : ""].filter(Boolean).join(" "),
            url: judicialOfficialUrl(row.jid),
            excerpt: row.content.slice(0, 420),
          })),
        ].slice(0, 3);
      } catch (cause) {
        platformLookupFailed = true;
        console.error("Pengli synchronized official lookup failed; continuing with official web search", cause);
      }
      const useOfficialWeb = sources.length === 0;
      const evidence = sources.map((source, index) => `【查證資料 ${index + 1}｜${source.label}】\n${source.excerpt}`).join("\n\n");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 28_000);
      let payload: Record<string, unknown>;
      try {
        payload = await openAIJson("/responses", { method: "POST", signal: controller.signal, body: JSON.stringify({
          model: "gpt-5.6-luna",
          ...(useOfficialWeb ? {
            tools: [{ type: "web_search", filters: { allowed_domains: OFFICIAL_LEGAL_DOMAINS } }],
            tool_choice: "required",
            include: ["web_search_call.action.sources"],
          } : {}),
          instructions: body.mode === "official-answer"
            ? `你是臺灣行政法官方資料查證員。教材全文未命中這個問題，只能依可核對的官方法規或裁判回答，不得使用模型記憶補足。${useOfficialWeb ? "平台同步資料未命中；本次必須搜尋且只能引用法務部全國法規資料庫、法務部或司法院官方網站。" : "只依下列平台已同步的官方法規／裁判資料回答。"}第一段以「官方資料補充：」開頭直接回答；第二段簡要說明依據；若資料不足，必須明寫「目前官方資料仍無法確認，建議轉請彭狸老師回答」。不得虛構法條、裁判、老師見解或教材頁碼，不得整段抄錄官方資料。全文 140 至 240 字，不使用 Markdown。${evidence ? `\n\n${evidence}` : ""}`
            : `你是臺灣行政法答案查證員。比較「原 AI 回覆」與「學生質疑」。${useOfficialWeb ? "平台同步資料未命中；本次必須搜尋且只能引用法務部全國法規資料庫、法務部或司法院官方網站。" : "只依下列平台已同步的官方法規／裁判資料驗證。"}\n\n判定規則：\n1. 必須區分「法條明文」、「裁判或函釋見解」與「教材／老師採取的學說或目的性限縮解釋」。法條沒有明文採取某項限縮，不等於該限縮見解錯誤。\n2. 不得只憑法條文義、條文未記載或概括連結其他條文，就推翻教材的解釋論見解。若官方資料只確認法條文字，應判為「存在不同見解」或「目前無法確認」。\n3. 只有直接相關的官方裁判、函釋或法條明文，明確與原回覆的同一命題衝突時，才能判「需要修正」。來源條號、案號或討論爭點不一致，不得引用，也不得判定原回覆錯誤。\n4. 原回覆若來自彭狸老師教材，應寫明「本書採取的見解」；查到不同官方實務時並列說明，不得冒充教材內容或擅自改寫老師立場。\n5. 學說或解釋爭議沒有足以定論的官方資料時，必須保留爭議並建議轉請彭狸老師確認。\n\n輸出依序只有三段：第一段以「查證結論：大致正確／存在不同見解／需要修正／目前無法確認」擇一；第二段用兩個短句說明關鍵理由；第三段只寫需修正處或學生下一步。不得整段抄錄官方資料、不得重複原 AI 回覆、不得列出搜尋過程。全文 140 至 260 字，不使用 Markdown。${evidence ? `\n\n${evidence}` : ""}`,
          input: body.mode === "official-answer" ? `【待查問題】\n${studentQuestion}` : `【原 AI 回覆來源】\n${sourceLabel || "未標示"}\n\n【原 AI 回覆】\n${aiReply}\n\n【學生質疑】\n${studentQuestion}`,
          max_output_tokens: 380,
        }) }) as Record<string, unknown>;
      } catch {
        if (controller.signal.aborted) return Response.json({ error: "官方資料查證逾時，此次不扣使用次數。請稍後再試。", code: "VERIFY_TIMEOUT" }, { status: 504 });
        return Response.json({ error: "目前無法連接官方資料查證服務，此次不扣使用次數。請稍後再試。", code: "VERIFY_SERVICE_ERROR" }, { status: 502 });
      } finally {
        clearTimeout(timeout);
      }
      if (useOfficialWeb) sources = officialWebSources(payload)
        .filter((source) => sourceMatchesExplicitReferences(source, articleReferences, exactCases))
        .map((source) => ({ ...source, excerpt: "官方外網補充" }));
      const uniqueSources = new Map<string, ReturnType<typeof localizedSource>>();
      for (const source of sources.filter((source) => Boolean(source.url))) {
        const localized = localizedSource({ ...source, url: String(source.url) });
        uniqueSources.set(localized.url, localized);
      }
      sources = [...uniqueSources.values()].slice(0, 3);
      let generatedVerification = compactVerification(localizeOfficialCitations(outputText(payload)));
      if (body.mode === "verify-doubt"
        && generatedVerification.startsWith("查證結論：需要修正")
        && isInterpretiveTeachingClaim(aiReply)
        && onlyBareStatuteSources(sources)) {
        generatedVerification = "查證結論：存在不同見解\n官方法條只能確認條文文義，不能單獨否定教材採取的目的性限縮或學說見解。現有官方資料未直接處理這項解釋爭議，因此不得判定教材錯誤；作答時應標明這是本書所採見解，必要時再轉請彭狸老師確認。";
      }
      const noOfficialSource = sources.length === 0;
      const verification = noOfficialSource
        ? "本次已搜尋相關法條、判決與裁判，但目前沒有找到足以核對這個問題的官方資料。本次不扣使用次數；你可以回到 AI 教練繼續釐清概念，或轉請彭狸老師確認。"
        : generatedVerification || "已找到可核對的官方資料，請直接開啟下方來源確認原文。";
      const searchTrace = { mode: useOfficialWeb ? "official_web" as const : "synchronized_official_data" as const, terms, platformLookupFailed, checkedAgencies: ["司法院", "憲法法庭", "全國法規資料庫", "法務部"] };
      if (noOfficialSource) {
        const [ticket] = await auth.db.insert(pengliTeacherQuestions).values({ memberId: auth.member.id, conversationKey: String(body.conversationKey ?? "").slice(0, 120), messageKey: String(body.messageKey ?? crypto.randomUUID()).slice(0, 120), topic: String(body.topic ?? "行政法").slice(0, 120), aiReply, studentQuestion, verificationResult: verification, verificationSourcesJson: "[]", status: "verified" }).returning();
        return Response.json({ verification, sources: [], noOfficialSource: true, officialWebFallback: useOfficialWeb, searchTrace, ticketId: ticket.id });
      }
      const access = await finishAiUse(gate, { action: "pengli_official_verification", description: "彭狸官方資料查證，成功扣 2 次", quantity: 2, requestKey: String(body.requestKey ?? crypto.randomUUID()) });
      const [ticket] = await auth.db.insert(pengliTeacherQuestions).values({ memberId: auth.member.id, conversationKey: String(body.conversationKey ?? "").slice(0, 120), messageKey: String(body.messageKey ?? crypto.randomUUID()).slice(0, 120), topic: String(body.topic ?? "行政法").slice(0, 120), aiReply, studentQuestion, verificationResult: verification, verificationSourcesJson: JSON.stringify(sources.map(({ label, url }) => ({ label, url }))), status: "verified" }).returning();
      return Response.json({ verification, sources: sources.map(({ label, url }) => ({ label, url })), noOfficialSource: false, officialWebFallback: useOfficialWeb, searchTrace, ticketId: ticket.id, access });
    }

    const selectedText = String(body.selectedText ?? "").trim().slice(0, 1200);
    const rawMessages = body.mode === "plain-explain" ? [{ role: "student", text: selectedText }] : (Array.isArray(body.messages) ? body.messages : []).slice(-8);
    const messages = rawMessages.map((message) => ({
      role: message.role === "coach" ? "assistant" : "user",
      content: String(message.text ?? "").slice(0, 2500),
    })).filter((message) => message.content.trim());
    if (!messages.length) return Response.json({ error: "請先輸入行政法問題。" }, { status: 400 });

    if (body.mode === "scholar-assist") {
      const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions: `你是「學霸幫我回答」功能，但前台仍把你顯示為學生本人，不是獨立角色。這只是對話模擬，不查教材資料庫，也不要求引用頁碼。請完整閱讀目前對話上下文，尤其是彭狸 AI 教練最後一個問題，替學生自然作答。

規則：
1. 第一段直接回答老師最後的問題；若老師問 A 或 B，必須先明確選擇，不可只說「視情況而定」。
2. 接著用2至4句，把對話中已出現的判準套用到題目事實；不要重複老師原話，不冒充老師，也不要寫成完整申論擬答。
3. 即使上下文沒有完整教材，也要依對話中已有資訊作合理的學生回答；不得因未搜尋資料庫而拒答。
4. 最後另起一行，以「我想再請問老師：」反問一個能推進學習的問題。優先改變一個關鍵事實、追問判準界線、比較相近法律效果，或詢問考場如何取捨。
5. 禁止詢問單純名詞定義、禁止重問老師剛才的問題、禁止一次串多題、禁止虛構法條或裁判。
6. 全文限180至320字，不使用 Markdown，不標示來源或頁碼。`,
        input: messages,
        max_output_tokens: 500,
      }) }) as Record<string, unknown>;
      const scholarDraft = plainText(outputText(payload));
      if (!scholarDraft) return Response.json({ error: "目前無法產生學生代答，請再按一次。" }, { status: 502 });
      return Response.json({ scholarDraft, source: "目前對話上下文" });
    }

    if (body.mode === "scholar-follow-up") {
      const hasVerifiedPage = Number(body.pageHint ?? 0) > 0 && Boolean(String(body.testSourceExcerpt || "").trim());
      const pageLabel = hasVerifiedPage ? `PDF 第 ${Math.floor(Number(body.pageHint))} 頁` : `目前主題「${String(body.topic || "行政法").slice(0, 120)}」`;
      const scopeInstruction = hasVerifiedPage
        ? `本輪固定範圍：${pageLabel}；考點「${String(body.testIssueTitle || "目前考點").slice(0, 120)}」；段落類型「${String(body.testBodyRole || "考點正文").slice(0, 80)}」。\n本頁可核對短語：「${String(body.testAnswerAnchor || "").slice(0, 100)}」\n本頁節錄：${String(body.testSourceExcerpt || "").slice(0, 1600)}`
        : `本輪依目前對話與主題「${String(body.topic || "行政法").slice(0, 120)}」作答。教練已經提出熱身題，不必等待書頁核對，也不得因沒有頁碼而拒答。`;
      const instructions = `你是正在拿著彭狸老師教材學習的學生。這個功能不是立刻亂出下一題，而是要先完整回答彭狸 AI 教練最後問你的問題，再沿著同一考點提出一個新的追問。

${scopeInstruction}

規則：
1. 先找出對話中「彭狸 AI 教練」最後一個明確問句，第一段必須直接回答它；不可跳過回答、不可只改寫老師的問題。
2. 回答要有明確結論與至少一個理由，限 70 至 180 個中文字。${hasVerifiedPage ? "若教材節錄不足，只能依老師上一答已說明的內容回答，不得自行補造。" : "依目前主題的基礎觀念與教練題目作答；不確定細節時用白話說明，不得虛構法條或裁判。"}
3. 第二段才提出一個新問題，限 25 至 70 個中文字；問題必須由第一段回答自然延伸，並鎖定同一主題；有核對書頁時才限於同一頁。
4. 追問可問判斷理由、適用方式、考場寫法或概念差異，但不得要求整章摘要或教材外資料。
5. 不得重複對話中已經問過的問題，不得再問「這頁在說什麼」，不得新增對話與已提供教材都沒有出現的法條、金額、案例、見解或名詞。
6. 不得留下半句、條列片段或只有結論沒有理由的回答。
7. answer 欄位只放完整回答；question 欄位只放一個接續問題。不要在欄位內重複「我的回答」或「我想再問老師」，不使用 Markdown、來源或頁碼。`;
      let result: { answer: string; question: string } | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        try {
          const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
            model: "gpt-5.6-luna",
            instructions: attempt === 0 ? instructions : `${instructions}\n\n前一次輸出未完成。這次務必讓 answer 有明確結論與理由，question 是一個完整問句。`,
            input: messages,
            text: { format: pengliScholarFollowUpFormat },
            max_output_tokens: attempt === 0 ? 900 : 1200,
          }) }) as Record<string, unknown>;
          result = parseScholarFollowUp(outputText(payload));
        } catch {
          result = null;
        }
      }
      const scholarFollowUp = result
        ? `我的回答：${result.answer}\n\n我想再問老師：${result.question}`
        : "我不懂，請老師再說明這題應該先從哪個判斷步驟開始？";
      return Response.json({ scholarFollowUp, source: `${pageLabel}｜目前對話上下文` });
    }

    const latestStudentText = [...rawMessages].reverse().find((message) => message.role !== "coach")?.text;
    const shortHelpReply = body.mode !== "plain-explain" && isShortHelpReply(String(latestStudentText ?? ""));
    const arrangeTopic = body.mode !== "plain-explain" && isCoachArrangementRequest(String(latestStudentText ?? ""));
    const searchMessages = shortHelpReply || arrangeTopic
      ? rawMessages.slice(0, -1).slice(-4)
      : latestStudentText
        ? [{ role: "student", text: latestStudentText }]
        : rawMessages.slice(-1);
    const searchText = searchMessages.map((message) => String(message.text ?? "")).filter(Boolean).join(" ");
    const pageHint = Number(body.pageHint ?? 0);
    const testContinuation = body.testContinuation === true;
    const normalizedPageQuestion = searchText.normalize("NFKC");
    const ambiguousDashPage = normalizedPageQuestion.match(/(?:第\s*)?(\d{1,4})\s*[-－—]\s*(\d{1,4})\s*頁/u);
    if (body.mode !== "plain-explain" && !(Number.isFinite(pageHint) && pageHint > 0) && ambiguousDashPage && !/書內頁碼|主題\s*[1-8]/u.test(normalizedPageQuestion)) {
      const left = Number(ambiguousDashPage[1]);
      const right = Number(ambiguousDashPage[2]);
      return Response.json({
        reply: `請確認一下：你是要問第 ${left} 頁到第 ${right} 頁的內容，還是書內頁碼 ${left}-${right}（主題 ${left} 的第 ${right} 頁）？請改成「第 ${left} 至 ${right} 頁」或「主題 ${left} 的第 ${right} 頁」。一次若問連續內容，最多只能問 3 頁；這次不扣使用次數。`,
        source: "等待確認頁碼｜尚未搜尋教材",
        pageClarificationRequired: true,
        retrievedPages: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const explicitRange = normalizedPageQuestion.match(/(?:第\s*)?(\d{1,4})\s*(?:到|至|～|~)\s*(?:第\s*)?(\d{1,4})\s*頁/u);
    const rangeStart = Number(explicitRange?.[1] || 0);
    const rangeEnd = Number(explicitRange?.[2] || 0);
    if (body.mode !== "plain-explain" && explicitRange && (rangeEnd < rangeStart || rangeEnd - rangeStart + 1 > 3)) {
      return Response.json({
        reply: rangeEnd < rangeStart
          ? `頁數順序好像反了。請告訴我單一頁，或依起訖順序提供最多 3 頁，例如「第 ${rangeEnd} 至 ${Math.min(rangeEnd + 2, rangeStart)} 頁」；這次不扣使用次數。`
          : `第 ${rangeStart} 至 ${rangeEnd} 頁共有 ${rangeEnd - rangeStart + 1} 頁，範圍太大。請指定單一頁，或縮小成最多連續 3 頁，例如「第 ${rangeStart} 至 ${rangeStart + 2} 頁」；這次不扣使用次數。`,
        source: "頁數範圍過大｜尚未搜尋教材",
        pageRangeTooLarge: true,
        retrievedPages: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.mode !== "plain-explain" && clearlyOutsidePengliScope(searchText)) return Response.json({
      reply: "這個問題不屬於彭狸老師行政法教材範圍，我先不回答，避免把其他科目或模型的一般知識混進教材學習。請改問行政法問題，或回到對應的科目專區；這次不扣使用次數。",
      source: "超出行政法教材範圍｜已拒絕回答",
      outOfScope: true,
      retrievedPages: [],
    }, { headers: { "Cache-Control": "no-store" } });
    if (body.mode !== "plain-explain" && body.boundaryTest === true) return Response.json({
      reply: "目前彭狸老師教材沒有這個問題的直接內容。我不會因為出現『行政機關』或『行政處分』等相近詞，就拿不相關的教材頁面補成答案。你可以選擇查證官方資料，或轉請彭狸老師回答；這次不扣使用次數。",
      source: "未找到對應書頁",
      evidenceMissing: true,
      missingQuestion: String(body.boundaryQuestion || searchText).slice(0, 2000),
      retrievedPages: [],
    }, { headers: { "Cache-Control": "no-store" } });
    const testDocumentId = Number(body.testDocumentId ?? 0);
    let evidence = await pengliEvidence(searchText, String(body.topic ?? ""), Number.isFinite(pageHint) && pageHint > 0 ? Math.floor(pageHint) : 0, Number.isFinite(testDocumentId) && testDocumentId > 0 ? Math.floor(testDocumentId) : 0);
    if (body.mode !== "plain-explain" && explicitRange && rangeEnd >= rangeStart && rangeEnd - rangeStart + 1 <= 3) {
      const pageEvidence = [];
      const explicitPdfRange = /pdf/u.test(normalizedPageQuestion.toLocaleLowerCase("zh-Hant"));
      for (let page = rangeStart; page <= rangeEnd; page += 1) {
        pageEvidence.push(await pengliEvidence(`第 ${page} 頁`, String(body.topic ?? ""), explicitPdfRange ? page : 0));
      }
      const firstEvidence = pageEvidence[0];
      evidence = {
        ...firstEvidence,
        rows: pageEvidence.flatMap((item) => item.rows),
        navigationPage: pageEvidence.some((item) => item.navigationPage),
        searchFailed: pageEvidence.some((item) => item.searchFailed),
        pageStatus: pageEvidence.some((item) => item.pageStatus === "outside")
          ? "outside"
          : pageEvidence.every((item) => item.pageStatus === "confirmed")
            ? "confirmed"
            : "unknown",
        bookPageLabel: pageEvidence.every((item) => item.bookPageLabel)
          ? `${pageEvidence[0].bookPageLabel} 至 ${pageEvidence.at(-1)?.bookPageLabel}`
          : "",
      };
    }
    if (evidence.navigationPage) return Response.json({
      reply: `PDF 第 ${evidence.requestedPage} 頁屬於封面、序言或目錄區，不作為教材正文回答。請告訴我正文頁數；這次不扣使用次數。`,
      source: "前置頁／目錄，不列入教材正文",
      retrievedPages: [],
      pageStatus: evidence.pageStatus,
    }, { headers: { "Cache-Control": "no-store" } });
    if (evidence.requestedPage > 0 && !evidence.rows.length) return Response.json({
      ...(body.testAnswerAnchor ? {
        reply: "本頁文字目前無法完成核對，系統已停止回答；本次不扣使用次數。",
        source: "書頁核對未完成｜本次不扣使用次數",
        retrievedPages: [],
        testVerified: false,
      } : {
        reply: evidence.pageStatus === "outside"
          ? `你指定的第 ${evidence.requestedPage} 頁不在本書頁數範圍內，請重新確認是書內頁碼還是 PDF 頁碼；這次不扣使用次數。`
          : `目前無法確認第 ${evidence.requestedPage} 頁的教材原文，我先不回答，避免引用錯頁；這次不扣使用次數。`,
        source: evidence.pageStatus === "outside" ? "頁碼不在本書範圍" : "教材頁碼無法確認",
        retrievedPages: [],
      }),
      pageStatus: evidence.pageStatus,
    }, { headers: { "Cache-Control": "no-store" } });
    if (body.mode !== "plain-explain" && !evidence.rows.length && !testContinuation) return Response.json({
      reply: "我已搜尋目前主題及整本教材，暫時找不到這個問題的直接資料。為避免 AI 幻覺，我不會用一般知識補成教材答案。你可以選擇查證官方資料，或轉請彭狸老師回答；這次不扣使用次數。",
      source: "未找到對應書頁",
      evidenceMissing: true,
      missingQuestion: searchText.slice(0, 2000),
      retrievedPages: [],
      pageStatus: "outside",
    }, { headers: { "Cache-Control": "no-store" } });
    const plainAiFallback = body.mode === "plain-explain" && body.allowAiFallback === true;
    const coachAiFallback = body.mode !== "plain-explain" && !evidence.rows.length;
    if (!evidence.rows.length && !plainAiFallback && body.mode === "plain-explain") return Response.json({
      error: body.mode === "plain-explain"
        ? "這段文字尚未命中彭狸老師教材。是否改由 AI 依臺灣行政法一般知識試著白話解釋？"
        : "已找到彭狸老師的書，但本題尚未命中頁面索引。請換成更明確的考點名稱後再試。",
      code: body.mode === "plain-explain" ? "PENGLI_EVIDENCE_NOT_FOUND" : "PENGLI_COACH_EVIDENCE_NOT_FOUND",
      canAiFallback: body.mode === "plain-explain",
    }, { status: 409 });

    const normalizedQuestion = searchText.normalize("NFKC").replace(/(?:書(?:本|內)?\s*)?第?\s*[1-8]\s*[-－—]\s*\d{1,3}\s*頁?/giu, " ").replace(/(?:pdf\s*)?第?\s*\d{1,4}\s*頁/giu, " ");
    const quotedFocusTerms = [...normalizedQuestion.matchAll(/[「『]([^」』]{3,36})[」』]/gu)].map((match) => match[1].trim());
    const phraseFocusTerms = (normalizedQuestion.match(/[\p{Script=Han}]{3,}/gu) ?? []).flatMap((phrase) => {
      const cleaned = phrase.replace(/^(?:老師|請問|這裡|這段|書上|教材|提到|所說|我想問|怎麼|如何)/u, "");
      if (cleaned.length <= 24) return [cleaned];
      const windows: string[] = [];
      for (let index = 0; index < cleaned.length; index += 6) {
        const window = cleaned.slice(index, index + 18);
        if (window.length >= 6) windows.push(window);
      }
      return windows;
    });
    const focusTerms = [...new Set([...quotedFocusTerms, ...phraseFocusTerms])]
      .filter((term) => term.length >= 3 && term.length <= 36)
      .sort((left, right) => right.length - left.length);
    const pageFocusMatched = evidence.rows.some((row) => {
      const normalizedRow = row.text.replace(/\s+/gu, " ").normalize("NFKC");
      return focusTerms.some((term) => normalizedRow.includes(term));
    });
    const evidenceText = evidence.rows.map((row, index) => {
      const page = row.pageStart ? `PDF 第 ${row.pageStart}${row.pageEnd && row.pageEnd !== row.pageStart ? `–${row.pageEnd}` : ""} 頁` : "PDF 頁碼待索引補正";
      const normalizedRow = row.text.replace(/\s+/gu, " ").trim();
      const matchedIndex = focusTerms.map((term) => normalizedRow.indexOf(term)).find((position) => position >= 0) ?? 0;
      const start = Math.max(0, matchedIndex - 110);
      const excerpt = normalizedRow.slice(start, Math.min(normalizedRow.length, start + 520));
      return `【教材片段 ${index + 1}｜${page}｜${row.hierarchyPath || row.title || "考點"}】\n${start > 0 ? "…" : ""}${excerpt}${start + excerpt.length < normalizedRow.length ? "…" : ""}`;
    }).join("\n\n");
    const model = "gpt-5.6-luna";

    if (body.mode === "plain-explain") {
      const startedAt = Date.now();
      const verificationRule = plainAiFallback
        ? "本段未命中彭狸老師教材；verification 必須明確寫「AI 補充，未命中彭狸老師教材，仍須核對法規與實務」。"
        : "本段已提供彭狸老師教材片段；verification 寫明已依《行政法考點演習書（二版）》教材片段核對，不得宣稱核對了未提供的法規或裁判原文。";
      const requestBody = {
        model,
        instructions: `你是臺灣行政法學習助教。請用與司律備考白話解釋相同的結構化品質處理框選文字，但彭狸專區必須以彭狸老師教材為優先依據。

analysis 欄位規則：
1. kind：辨識為法條、裁判字號、法律概念、學說、課程章節標題或一般法律文字。
2. officialName：寫正式名稱；無特定正式名稱時說明它是何種學習範圍，不要硬造名稱。
3. legalField：填行政法或更精確的行政法子領域。
4. nature：說明它在考試與法律論證中的功能。
5. reference：有明確法條、釋字或裁判且教材片段確有提及才填；否則明寫「未對應特定法條或裁判」。
6. points：列出3至5個真正的拆解重點，包含判斷順序、構成要素或概念界線。
7. verification：${verificationRule}
8. caveat：提醒教材範圍、爭議或仍須查證處；沒有則填空字串。

explanation 用150至300字白話講懂原文，不得只是重複原句。
notePoints 必須恰好三點，每個陣列項目只放內容、禁止自行加「一、二、三」或數字編號，且不能重寫 explanation；三點分別延伸：
一、相近概念的區分或體系位置；
二、考場判斷步驟與作答方法；
三、常見誤判、例外、爭議或變化題。
不得虛構法條、裁判、教材頁碼或老師觀點。${plainAiFallback ? "" : `\n\n【彭狸老師專屬教材】\n${evidenceText}`}`,
        input: `【學生框選文字】\n${selectedText}`,
        text: { format: pengliPlainResponseFormat },
        max_output_tokens: 850,
      };
      let payload: Record<string, unknown> = {};
      let parsed: PengliPlainExplanation | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify(requestBody) }) as Record<string, unknown>;
        parsed = parsePengliPlainExplanation(outputText(payload));
      }
      if (!parsed) return Response.json({ error: "AI 回傳格式不完整，請再試一次。" }, { status: 502 });
      const access = await finishAiUse(gate, { action: "pengli_plain_explain", description: "彭狸教材白話解釋，成功扣 1 次", requestKey: String(body.requestKey ?? crypto.randomUUID()) });
      const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
      const inputTokens = Number(rawUsage.input_tokens ?? 0), cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0), outputTokens = Number(rawUsage.output_tokens ?? 0);
      const costMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
      const notePoints = parsed.notePoints.map((point, index) => `${["一", "二", "三"][index]}、${point.replace(/^(?:[一二三四五六七八九十]|\d+)[、．.)）]\s*/u, "").trim()}`).join("\n");
      return Response.json({
        explanation: parsed.explanation,
        analysis: parsed.analysis,
        notePoints,
        access,
        aiFallback: plainAiFallback,
        sourceStatus: plainAiFallback ? "AI 補充，未命中彭狸老師教材" : "彭狸老師教材",
        usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 },
      });
    }

    const coachPages = [...new Set(evidence.rows.flatMap((row) => row.pageStart ? [row.pageStart] : []))].sort((left, right) => left - right);
    const requestedPageRule = coachPages.length > 1
      ? `學生指定閱讀 PDF 第 ${coachPages[0]} 至 ${coachPages.at(-1)} 頁；本輪已提供這 ${coachPages.length} 頁原文，只能綜合這些頁面回答，不得轉答其他頁。先用2至4句概括這幾頁的共同重點，再問一個簡短問題。`
      : evidence.requestedPage > 0
        ? `學生已指定正在閱讀 PDF 第 ${evidence.requestedPage} 頁；只能回答本輪提供的該頁教材內容，不得轉答其他頁。${pageFocusMatched ? "先直接解釋學生提到的考點，再問一個能推進理解的小問題。" : "學生只表示這一頁看不懂；不要要求他重貼內容，先用2至3句說明該頁主要內容與最重要的一個考點，再問他是卡在概念、判斷步驟或例子。"}`
        : "";
    const startedAt = Date.now();
    const testIssueTitle = String(body.testIssueTitle ?? "").trim().slice(0, 100);
    const testBodyRole = String(body.testBodyRole ?? "").trim().slice(0, 40);
    const testSourceExcerpt = String(body.testSourceExcerpt ?? "").trim().slice(0, 900);
    const testAnswerAnchor = String(body.testAnswerAnchor ?? "").trim().slice(0, 80);
    const interactionRule = arrangeTopic
      ? "學生已表示沒有指定內容，請教練安排。直接依本輪教材片段選擇最適合先學的前置重點：先用 2 至 4 句說明本章為何從這裡開始，再問一個只檢查這個重點的簡短問題。不得要求學生再選一次，也不得跳到教材外的通用熱身題。"
      : testAnswerAnchor && !testContinuation
      ? "學生本輪是在依書頁提出問題，不是在回答教練；像真人老師自然接話並直接回答。可從『這一頁的重點是』『這裡要先分清楚』『本頁先處理的是』開始，禁止用『你的定位正確』『你的理解正確』『你的判斷正確』『你答得對』等系統式評語開頭。"
      : testContinuation
        ? "學生本輪已先回答再提出新問題；像真人老師自然承接。若答案有錯才用一句話指出哪裡要修正；若答案正確就直接回答新問題，不要先說『你的理解正確』『你的定位正確』『你的判斷正確』或其他制式稱讚。"
        : "先判斷學生是在回答上一問或提出新問題；只有確實回答上一問且有必要時才給簡短回饋，新問題則像真人老師一樣直接回答，不要先做系統式正誤宣告。";
    const legalTeachingRule = `法律教學判斷規則：
1. 先判斷學生問的是「概念／答題方法」還是「特定法條、裁判、修法或個案結論」。概念與答題方法應直接依教材、對話與行政法基礎架構回答，不得因缺少案號、完整事實或官方資料就拒答，也不得把學生推去查官方資料。
2. 個案事實不足時，先說明目前能確定的判斷架構，再只追問一個真正會改變結論的關鍵事實；禁止一開始連續索取處分、法條、緊急狀況等多項資料而中斷教學。
3. 不得只以法條使用「應」或「得」就斷定羈束或裁量；還要說明規範目的、法律效果結構、個案限制及是否仍有兩種以上合法選項。
4. 談裁量收縮至零時，只有在個案中僅剩一種合法決定，才可說裁量可能收縮至零。可依重大法益與急迫危險、平等原則與行政自我拘束、比例原則、保護義務及其他個案特殊因素判斷。
5. 不得把「裁量收縮至零」直接等同「人民必然可以請求特定處分」；若涉及行政救濟，還要區分是否具有公法上請求權、訴訟類型及法院可作成的判決。
6. 回答採「先回答當前問題→給判斷順序→用一個問題推進」；不要突然改寫成法律諮詢表單、完整申論稿或長篇教科書。`;
    const testRule = testAnswerAnchor ? testContinuation
      ? `本輪是同一個已通過核對書頁的接續對話。仍須鎖定考點「${testIssueTitle || "未命名考點"}」與本頁內容，但核對短語「${testAnswerAnchor}」已在前輪出現，本輪不得再次逐字重貼或重新介紹前提。直接回答學生這次的新問題；只有學生答錯、混淆前提或明確要求重述時，才用一句話簡短提醒。${testSourceExcerpt ? `本頁節錄僅供承接判斷：\n${testSourceExcerpt}\n` : ""}`
      : `本輪是書頁內容驗證。目錄已確認本頁隸屬考點「${testIssueTitle || "未命名考點"}」，本頁類型為「${testBodyRole || "考點正文"}」。這兩項是系統已核對的定位，不得否定、不得改稱為其他考點。核對短語「${testAnswerAnchor}」必須逐字出現在回答中，以證明回答確實取自本頁；但仍須用白話解釋它在本頁的作用。${testSourceExcerpt ? `抽樣頁原文如下：\n${testSourceExcerpt}\n` : ""}若本頁只是案例事實，說明案例正在問什麼；若是考點破解，說明題目測什麼及書中解題順序。若單頁不足以完成解釋，明說本頁只能確認到哪裡，不得拿其他考點補答案。`
      : "";
    const instructions = `你是「彭狸 AI 教練」，是依彭狸老師教材建立的 AI 分身，不是真人老師。${coachAiFallback ? `這是教練主動提出熱身題後的接續對話；即使教材沒有逐字答案，也必須依目前章節、前文與臺灣行政法基礎觀念，用白話回答學生的作答方法或概念問題。前台會標示為「AI 作答建議」，不得冒充彭狸老師教材原文，不得虛構法條、裁判或頁碼，也不得改成查證官方資料或轉請老師。` : "只能用本次提供的彭狸老師《行政法考點演習書（二版）》片段引導學生，不得混用其他司律老師教材，也不得用一般知識補足教材未記載的內容。"}${evidence.bookPageLabel && !evidence.bookPageLabel.includes("至") ? `重要：學生所說的「書內頁碼 ${evidence.bookPageLabel}」是一個章節式單一頁碼；連字號前是主題編號、後是該主題內頁碼，絕對不是第 ${evidence.bookPageLabel.split("-")[0]} 頁到第 ${evidence.bookPageLabel.split("-")[1]} 頁的範圍。系統已精準換算為 PDF 第 ${evidence.requestedPage} 頁並提供原文，必須直接說明內容，不得聲稱找不到或要求學生另給頁碼。` : ""}${requestedPageRule}${testRule}${interactionRule}\n${legalTeachingRule}\n回答精簡、口語，一次只教一個判斷步驟；回答完可問一個能推進理解的小問題，不要一次傾倒完整擬答。每次回答必須寫完最後一句，不得停在「的」、「對」、「與」、「或」等未完詞句。${shortHelpReply ? "學生只是在表示不知道或請求提示；直接承接上一輪問題，縮小成一個更容易回答的判斷入口，不要要求學生重述題目。" : ""}${pageFocusMatched ? "必須沿用學生問題中逐字引用的教材短語，讓學生能在書上核對。" : ""}正文中不要插入任何來源或頁碼；頁碼由系統依實際命中的原始教材頁面固定標示，禁止自行猜測或輸出頁碼。禁止使用 Markdown 符號（包括 **、#、>），不要生成 AI 學霸內容。\n${teacherContext}\n\n【本輪彭狸老師專屬教材】\n${evidenceText}`;
    let payload: Record<string, unknown> = {};
    let reply = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
        model,
        instructions: `${instructions}${attempt ? "\n上次回答未完整或未通過書頁核對。這次必須完整寫完最後一句；若是書頁核對，也必須保留目錄指定考點與核對短語。" : ""}`,
        input: messages,
        max_output_tokens: attempt ? 900 : 700,
      }) }) as Record<string, unknown>;
      const rawReply = plainText(outputText(payload).replace(/【教練回應】/gu, "").replace(/【學霸追問】[\s\S]*$/u, ""));
      reply = rawReply.replace(/\s*[（(]?\s*依據[：:][^\n]*第\s*\d+(?:\s*[–—-]\s*\d+)?\s*頁\s*[）)]?\s*$/u, "").trim();
      reply = removeUnsupportedTrailingForeignText(reply, evidenceText);
      const compactReply = reply.normalize("NFKC").replace(/\s+/gu, "");
      const compactAnchor = testAnswerAnchor.normalize("NFKC").replace(/\s+/gu, "");
      const deniesMappedIssue = Boolean(testIssueTitle) && new RegExp(`(?:不是|並非)(?:在)?(?:說|談|討論)?[「『]?${testIssueTitle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").test(reply);
      if (outputWasTruncated(payload)) {
        reply = "";
        continue;
      }
      if (!testAnswerAnchor || (testContinuation ? !deniesMappedIssue : compactReply.includes(compactAnchor) && !deniesMappedIssue)) break;
      reply = "";
    }
    if (!reply && testAnswerAnchor) reply = `這一頁仍屬於「${testIssueTitle || "本考點"}」${testBodyRole ? `的「${testBodyRole}」` : ""}。本頁可直接核對的內容是：「${testAnswerAnchor}」。因此只能先依這段原文理解本頁，不能自行改判成其他考點；若要完整作答，還要接著核對前後頁的說明。`;
    if (!reply) return Response.json({ error: "彭狸 AI 教練沒有產生可顯示的回答。" }, { status: 502 });
    const retrievedPages = [...new Set(evidence.rows.map((row) => row.pageStart).filter((page): page is number => page != null))];
    const compactVerifiedReply = reply.normalize("NFKC").replace(/\s+/gu, "");
    const testVerified = !testAnswerAnchor || (
      Number.isFinite(pageHint)
      && pageHint > 0
      && retrievedPages[0] === Math.floor(pageHint)
      && (testContinuation || compactVerifiedReply.includes(testAnswerAnchor.normalize("NFKC").replace(/\s+/gu, "")))
    );
    if (!testVerified) return Response.json({
      reply: "本頁文字目前無法完成核對，系統已停止回答；本次不扣使用次數。",
      source: "書頁核對未完成｜本次不扣使用次數",
      retrievedPages,
      testVerified: false,
    }, { headers: { "Cache-Control": "no-store" } });
    const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(rawUsage.input_tokens ?? 0);
    const cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(rawUsage.output_tokens ?? 0);
    const costMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    try { const db = await getDb(); await db.insert(usageLogs).values({ model, source: "彭狸老師專區｜AI 分身教練", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: costMicros }); } catch { /* 回答不因成本紀錄失敗而中斷 */ }
    const access = await finishAiUse(gate, { action: "pengli_coach", description: "彭狸 AI 分身陪練，成功扣 1 次", requestKey: String(body.requestKey ?? crypto.randomUUID()) });
    const fallbackPage = evidence.rows.find((row) => row.pageStart)?.pageStart;
    const citedPage = fallbackPage ? String(fallbackPage) : "頁碼待索引補正";
    const source = coachAiFallback ? "AI 作答建議｜依目前章節與對話" : citedPage === "頁碼待索引補正" ? `行政法考點演習書（二版）》${citedPage}` : evidence.bookPageLabel ? `行政法考點演習書（二版）》書內第 ${evidence.bookPageLabel} 頁（PDF 第 ${citedPage} 頁）` : `行政法考點演習書（二版）》PDF 第 ${citedPage} 頁`;
    return Response.json({ reply, source, sourceMode: evidence.sourceMode, pageStatus: evidence.pageStatus, retrievedPages, testVerified: testAnswerAnchor ? true : undefined, access, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 } });
  } catch (error) {
    console.error("Pengli coach request failed", error);
    return Response.json({ error: "教材搜尋暫時沒有完成，請再按一次；若仍無法回答，請換成較精簡的考點名稱。" }, { status: 500 });
  }
}
