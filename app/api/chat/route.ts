type ClientMessage = { role: "mentor" | "student" | "scholar"; text: string };
type ChatContext =
  | { type: "home" }
  | { type: "book"; resourceId: number; segmentId: number; resourceTitle: string; segmentTitle: string }
  | { type: "magazine"; resourceId: number; resourceTitle: string }
  | { type: "my-course" | "public-course"; resourceId: number; episodeId: number; resourceTitle: string; episodeTitle: string };
type PlanningConstraint = { mode: "all" | "single"; subject: string; scope: string; replaceOnlySubject: boolean; days: number; dailyMinutes: number };
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { storedDocumentAnalysis } from "../../../lib/document-analysis";
import { syncBookLearningRecord } from "../../../lib/book-learning-record";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIKey, getOpenAIModel, getTeachingJudgeOpenAIModel, getZaiKey, getZaiModel } from "../../../lib/openai";
import { taipeiDate, taipeiGreeting } from "../../../lib/taipei-time";
import { normalizeMcqOptions } from "../../../lib/exam-options";
import { appSettings, chatComparisonResponses, chatComparisons, chatMessages, chatSessions, documents, examQuestions, learningResources, resourceSegments, studyPlans, studyRecords, studyTasks, usageLogs } from "../../../db/schema";
import { compactConversation } from "../../../lib/input-budget";
import { formatExternalCatalogEvidence, searchExternalCatalog } from "../../../lib/external-catalog-search";
import { documentDisplayTitle, documentDisplayTitleFromMetadata } from "../../../lib/document-title";
import { coachWebSearchAvailable, finishAiCoachRound, finishAiUse, markCoachWebSearchUsed, prepareAiUse } from "../../../lib/ai-access-gate";

type ChatProvider = "luna" | "sol" | "sonnet" | "deepseek" | "glm" | "glm52";
type ChatModelMode = "auto" | ChatProvider | "compare-luna-sonnet" | "compare-luna-glm52" | "compare-luna-deepseek" | "compare-sonnet-deepseek" | "compare-luna-sonnet-deepseek";
type TeachingLevel = "beginner" | "intermediate" | "advanced" | "super";

function activeProviders(mode: ChatModelMode): ChatProvider[] {
  if (mode === "auto") return ["luna"];
  if (mode.startsWith("compare-")) return mode.slice("compare-".length).split("-") as ChatProvider[];
  return [mode];
}

function providerLabel(provider: ChatProvider) {
  return provider === "luna" ? "Luna" : provider === "sol" ? "Sol" : provider === "sonnet" ? "Claude Sonnet" : provider === "glm" ? "GLM-4.7-Flash（免費測試）" : provider === "glm52" ? "GLM-5.2（付費測試）" : "DeepSeek V4-Pro";
}

function automaticRoute(query: string, context: ChatContext, hasVerifiedAnswer: boolean) {
  const compact = query.replace(/\s+/g, "");
  const formal = /正式批改|批改申論|完整申論|考場擬答|建立標準解析|最終法律檢核|自訂新題/.test(compact);
  const highRisk = /多人|多行為|競合|不能未遂|不作為|身分犯|因果歷程|學說評析|爭點完整|罪責/.test(compact);
  if (formal || (!hasVerifiedAnswer && highRisk && compact.length >= 180)) {
    return { provider: "sol" as const, reason: formal ? "本次要求正式批改、完整申論或標準解析，需由 Sol 進行高精度法律判斷。" : "本題未命中已審核標準答案，且涉及多重高風險法律爭點，因此升級 Sol。" };
  }
  if (compact.length >= 500 || /請整理以下長文|逐一整理所有行為人|跨章節統整/.test(compact)) {
    return { provider: "sol" as const, reason: "本次內容較長，需統整多段事實或多位行為人，因此升級由 Sol 進行法律分析。" };
  }
  if (context.type === "book" && hasVerifiedAnswer) return { provider: "luna" as const, reason: "已精準命中本題老師解析或指定教材章節，模型只需依既有資料引導學習，因此選用 Luna。" };
  return { provider: "luna" as const, reason: "本次屬一般教學、簡短問答或學習規劃，Luna 已足以完成並可控制成本。" };
}

const homeLegalScopeTerms = /法律|法條|法規|刑法|民法|憲法|行政法|民訴|刑訴|商法|司律|律師|司法官|申論|真題|爭點|法學|判決|裁判|罪|犯罪|責任|契約|債權|物權|繼承|婚姻|訴訟|訴願|國考|考試|讀書計畫|學習紀錄|平台|網站|功能|登入|帳號|題庫|教材|智能書/u;
const clearlyNonLegalHomeQuery = /天氣|氣象|食譜|怎麼煮|料理|餐廳|旅遊|景點|機票|住宿|股票|基金|匯率|球賽|棒球|足球|電影|追劇|遊戲|歌詞|程式碼|寫程式|Python|JavaScript|Excel公式|健身|減肥|感情|戀愛|醫療診斷|症狀|藥物|疾病|手機推薦|電腦推薦|購物|商品推薦/u;

function shouldRefuseHomeQuery(query: string) {
  const compact = query.replace(/\s+/g, "");
  return compact.length >= 2 && clearlyNonLegalHomeQuery.test(compact) && !homeLegalScopeTerms.test(compact);
}

function providerReply(
  provider: ChatProvider,
  replies: { luna: string; deepseek: string; zai: string; sonnet?: string },
) {
  if (provider === "luna" || provider === "sol") return replies.luna;
  if (provider === "deepseek") return replies.deepseek;
  if (provider === "glm" || provider === "glm52") return replies.zai;
  return replies.sonnet ?? "";
}

type TeachingEvidence = {
  status: "verified" | "applied_inference" | "full_text_search" | "unavailable";
  retrieval: "chapter_segment" | "stored_analysis" | "full_text_search" | "none";
  resourceId: number;
  segmentId: number;
  resourceTitle: string;
  segmentTitle: string;
  lessonLabel: string;
  pageStart: number | null;
  pageEnd: number | null;
  fileName: string;
  excerpt: string;
  message: string;
  matchedTerms?: string[];
  basis?: "teacher_solution" | "chapter";
};

function problemSolutionParts(value: string) {
  const normalized = value
    .replace(/[□◆◇■●▶▷◀◁]+/gu, " ")
    .replace(/爭\s*點\s*解\s*析/gu, "爭點解析")
    .replace(/擬\s*答\s*[:：]/gu, "擬答：");
  const structured = normalized.match(/^【完整題目】\s*([\s\S]*?)\s*\n\s*【(爭點解析|擬答)】\s*([\s\S]+)$/u);
  if (structured) return { question: structured[1].trim(), analysis: structured[3].trim(), marker: structured[2] };
  const boundary = /(?:【\s*)?爭點解析(?:\s*】)?\s*[:：]?|(?:【\s*)?擬答(?:\s*】)?\s*[:：]/u.exec(normalized);
  if (!boundary || boundary.index === undefined) return { question: normalized.trim(), analysis: "", marker: "" };
  return {
    question: normalized.slice(0, boundary.index).trim(),
    analysis: normalized.slice(boundary.index + boundary[0].length).trim(),
    marker: boundary[0].includes("擬答") ? "擬答" : "爭點解析",
  };
}

const evidenceStopTerms = new Set([
  "刑法", "法律", "犯罪", "行為", "結果", "問題", "判斷", "檢驗", "學生", "教材", "本章", "可以", "是否", "如何", "以及", "如果", "因為", "所以", "仍然", "需要", "就是", "這是", "具有", "成立", "不同", "原則", "規定",
]);

function evidenceTerms(value: string) {
  const normalized = value.replace(/[\s\p{P}\p{S}]+/gu, "");
  const terms = new Set<string>();
  for (const match of value.matchAll(/[\p{Script=Han}]{2,10}|[A-Za-z][A-Za-z0-9.-]{2,}/gu)) {
    const term = match[0].toLowerCase();
    if (!evidenceStopTerms.has(term) && term.length >= 2) terms.add(term);
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const term = normalized.slice(index, index + 2);
    if (!evidenceStopTerms.has(term)) terms.add(term);
  }
  for (const term of legalExampleTerms(value)) terms.add(term);
  for (const match of value.matchAll(/擴張解釋|限縮解釋|類推適用|目的性限縮|文義解釋|體系解釋|歷史解釋|目的解釋|罪刑法定|不溯及既往|構成要件|保護法益|住宅|樓梯間/gu)) {
    terms.add(match[0]);
  }
  return terms;
}

function legalExampleTerms(value: string) {
  const terms = new Set<string>();
  // 中文沒有空白分詞；先以標點與常見並列詞拆開，避免
  // 「公然侮辱罪與殺人罪」被視為一個長字串而漏掉兩個罪名。
  const pieces = value.split(/[\s，。；：、！？（）()［］\[\]「」『』]|(?:以及|以及其|與|和|及)/u);
  for (const piece of pieces) {
    for (const match of piece.matchAll(/([\p{Script=Han}]{2,8}(?:罪|犯))/gu)) {
      let term = match[1];
      term = term.replace(/^(例如|其中|哪些屬於|屬於|本類型|第一節)/u, "");
      if (term.length >= 3) terms.add(term.toLowerCase());
    }
  }
  return terms;
}

function relevantExcerpt(text: string, query: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 520) return compact;
  const queryTerms = evidenceTerms(query);
  const candidates: string[] = [];
  for (let start = 0; start < compact.length; start += 240) {
    candidates.push(compact.slice(Math.max(0, start - 80), Math.min(compact.length, start + 520)));
  }
  const score = (candidate: string) => {
    const candidateTerms = evidenceTerms(candidate);
    let hits = 0;
    for (const term of queryTerms) if (candidateTerms.has(term)) hits += term.length >= 4 ? 3 : 1;
    return hits;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0]?.slice(0, 520) || compact.slice(0, 520);
}

function evidenceSupportKind(excerpt: string, query: string, reply: string): "direct" | "applied" | "insufficient" {
  if (excerpt.length < 80 || /目錄|章節目次|世界上有男人、女人|本章將介紹/.test(excerpt.slice(0, 180))) return "insufficient";
  const excerptTerms = evidenceTerms(excerpt);
  const claimTerms = evidenceTerms(reply);
  const queryTerms = evidenceTerms(query);
  const meaningfulHits = [...claimTerms].filter((term) => term.length >= 3 && excerptTerms.has(term));
  const longHits = meaningfulHits.filter((term) => term.length >= 4);
  const queryHits = [...queryTerms].filter((term) => term.length >= 3 && excerptTerms.has(term));
  const requestedExamples = legalExampleTerms(`${query} ${reply}`);
  const directlyNamedExamples = [...requestedExamples].filter((term) => excerptTerms.has(term));
  const containsClassification = /行為犯|舉動犯|結果犯|危險犯|狀態犯|身分犯|加重結果犯/.test(excerpt);
  const isTeachingQuestion = /(?:問題|請問|請說明|你認為|如何判斷|屬於哪一種|[？?])/.test(reply);
  const teachingQuestionConcepts = [
    "擴張解釋", "限縮解釋", "類推適用", "目的性限縮", "文義解釋", "體系解釋",
    "歷史解釋", "目的解釋", "住宅", "樓梯間", "構成要件", "保護法益",
  ].filter((term) => reply.includes(term) && excerpt.includes(term));

  // 教材同時逐名列出題目中的具體罪名與其分類時，答案已由原文直接記載；
  // 不應因 AI 以提問方式帶學習，或中文分詞漏字，而降級成「支持不足」。
  if (containsClassification && directlyNamedExamples.length >= 2) return "direct";
  // 智能書常先依教材中的具體案例出題，而不是立即公布答案。只要題幹、
  // 選項式判準與教材案例均可逐一回查，這一輪教學內容本身就是直接引用；
  // 不應因回覆採問句形式而誤降為「支持不足」。
  if (isTeachingQuestion && teachingQuestionConcepts.length >= 3) return "direct";
  if (longHits.length < 2 && meaningfulHits.length < 4) return "insufficient";

  const replyConcepts = [...claimTerms].filter((term) => term.length >= 3);
  const coverage = meaningfulHits.length / Math.max(1, replyConcepts.length);
  const containsRuleLanguage = /區分|標準|判準|要件|原則|係指|稱為|只要|必須|無須|不以|依據|取決於/.test(excerpt);
  const appliesToConcreteExamples = queryHits.length >= 2 && [...queryTerms].some((term) => term.length >= 3 && !excerptTerms.has(term));

  // 教材已直接寫出主要結論時列為直接支持；教材提供抽象判準、
  // 回答再把判準套用到題目罪名或事實時，保留為獨立的涵攝狀態。
  if (coverage >= 0.62) return "direct";
  if (containsRuleLanguage && appliesToConcreteExamples) return "applied";
  return longHits.length >= 3 || meaningfulHits.length >= 6 ? "applied" : "insufficient";
}

function matchedEvidenceTerms(excerpt: string, query: string, reply: string) {
  const excerptTerms = evidenceTerms(excerpt);
  return [...evidenceTerms(`${query} ${reply}`)]
    .filter((term) => term.length >= 3 && excerptTerms.has(term))
    .sort((a, b) => b.length - a.length)
    .filter((term, index, all) => !all.slice(0, index).some((existing) => existing.includes(term)))
    .slice(0, 8);
}

function analysisRows(document: typeof documents.$inferSelect, mode: "chapters" | "questions") {
  const analysis = storedDocumentAnalysis(document.processingResultJson || "{}");
  const rows = mode === "chapters" ? analysis.chapters : analysis.questions;
  return Array.isArray(rows) ? rows : [];
}

function field(row: unknown, keys: string[]) {
  if (!row || typeof row !== "object") return "";
  for (const key of keys) {
    const value = String((row as Record<string, unknown>)[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function numberField(row: unknown, keys: string[]) {
  if (!row || typeof row !== "object") return null;
  for (const key of keys) {
    const value = Number((row as Record<string, unknown>)[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function readBookTeachingEvidence(context: Extract<ChatContext, { type: "book" }>, query: string): Promise<TeachingEvidence> {
  const unavailable = (fileName = "") : TeachingEvidence => ({
    status: "unavailable",
    retrieval: "none",
    resourceId: context.resourceId,
    segmentId: context.segmentId,
    resourceTitle: context.resourceTitle,
    segmentTitle: context.segmentTitle,
    lessonLabel: "",
    pageStart: null,
    pageEnd: null,
    fileName,
    excerpt: "",
    message: "這一章目前只有目錄或摘要，尚未取得可核對的教材原文。",
  });

  const db = await getDb();
  const [resource] = await db.select().from(learningResources).where(eq(learningResources.id, context.resourceId)).limit(1);
  if (!resource?.documentId) return unavailable();
  const [document] = await db.select().from(documents).where(eq(documents.id, resource.documentId)).limit(1);
  if (!document) return unavailable();

  let row: {
    id: number;
    title: string;
    lessonLabel: string;
    pageStart: number | null;
    pageEnd: number | null;
    text: string;
    summary: string;
    retrieval: "chapter_segment" | "stored_analysis";
  } | null = null;

  if (context.segmentId > 0) {
    const [segment] = await db.select().from(resourceSegments).where(
      and(eq(resourceSegments.id, context.segmentId), eq(resourceSegments.resourceId, context.resourceId)),
    ).limit(1);
    if (segment) {
      row = {
        id: segment.id,
        title: segment.title,
        lessonLabel: segment.lessonLabel,
        pageStart: segment.pageStart,
        pageEnd: segment.pageEnd,
        text: segment.text.trim(),
        summary: segment.summary.trim(),
        retrieval: "chapter_segment",
      };
    }
  }

  if (!row && context.segmentId < 0) {
    const mode = /解題|題庫|題型|案例演習|申論/.test(`${resource.title} ${resource.description ?? ""}`) ? "questions" : "chapters";
    const rows = analysisRows(document, mode);
    const source = rows[Math.abs(context.segmentId) - 1] ?? rows.find((candidate) =>
      field(candidate, ["title", "question_title", "question_no", "number"]) === context.segmentTitle,
    );
    if (source) {
      const title = field(source, ["title", "question_title", "question_no", "number"]) || context.segmentTitle;
      const section = field(source, ["section", "part", "section_path", "path"]);
      const topic = field(source, ["chapter", "topic", "theme", "subject"]);
      row = {
        id: context.segmentId,
        title,
        lessonLabel: `${section || (mode === "chapters" ? "教材章節" : "題型目錄")}｜${topic || "其他題型"}`.slice(0, 160),
        pageStart: numberField(source, ["page_start", "pageStart"]),
        pageEnd: numberField(source, ["page_end", "pageEnd"]),
        text: field(source, ["content", "text", "stem", "question_text", "question"]),
        summary: field(source, ["summary"]),
        retrieval: "stored_analysis",
      };
    }
  }

  const text = row?.text.trim() ?? "";
  if (!row || text.length < 40) return unavailable(document.fileName);
  const isProblemSolving = /解題|題庫|題型|案例演習|申論/.test(`${resource.title} ${resource.description ?? ""}`);
  const solution = isProblemSolving ? problemSolutionParts(text) : null;
  if (isProblemSolving && (!solution?.question || solution.analysis.length < 40)) {
    return {
      ...unavailable(document.fileName),
      message: "本題尚未成功綁定可核對的老師爭點解析／擬答，已停止依教材作答並保留待核對。",
    };
  }
  const pages = row.pageStart
    ? `第 ${row.pageStart}${row.pageEnd && row.pageEnd !== row.pageStart ? `–${row.pageEnd}` : ""} 頁`
    : "頁碼待核對";
  const excerpt = solution ? solution.analysis.slice(0, 12000) : relevantExcerpt(text, query);
  return {
    status: "verified",
    retrieval: row.retrieval,
    resourceId: resource.id,
    segmentId: row.id,
    resourceTitle: resource.title,
    segmentTitle: row.title || context.segmentTitle,
    lessonLabel: row.lessonLabel,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    fileName: document.fileName,
    excerpt,
    message: solution
      ? `已鎖定同一題的老師${solution.marker || "爭點解析／擬答"}（${pages}），作為本次解題教學的主要依據。`
      : `已從本章原文選出與本次問題最接近的片段（${pages}）；回答完成後仍會檢查支持度。`,
    basis: solution ? "teacher_solution" : "chapter",
  };
}

async function readExternalCatalogEvidence(query: string) {
  return formatExternalCatalogEvidence(await searchExternalCatalog(query, 6));
}

const baseInstructions = `你是「司律備考」的 AI 學習教練，專門協助台灣律師與司法官考試。
你的任務是教會學生思考，不是立刻交付完整答案。

對話規則：
1. 使用繁體中文與中華民國法律語境。
2. 像真人老師自然對話，每次聚焦一個清楚、學生可以直接回答的問題。
3. 主動判斷學生的程度與下一個學習步驟，不等待學生設計課程。
4. 優先引導學生辨認題目事實、爭點與法律關係；除非學生明確要求，不要第一輪就公布完整解答。
5. 學生答錯時，先指出已經抓對的部分，再給一層提示或更小的問題。
6. 不要使用僵硬的「教學卡、步驟一、步驟二」口吻，不要一次問很多問題。
7. 若資訊不足或法律內容不確定，要直接說明，不得捏造法條、判決或教材來源。
8. 回覆通常控制在 80 至 220 個中文字；必要時可稍長。
9. 若檔案搜尋工具找到教材內容，必須以教材為優先依據；找不到時才使用一般模型知識，且不得捏造教材來源。
10. 當你已經知道學生的考試目標、每日可用時間與目前學習需求，而且目前尚無計畫，才主動呼叫 save_study_plan，建立接下來 7 天可執行的讀書計畫。
11. 行事曆任務必須使用真實 YYYY-MM-DD 日期；不得把尚未公布的考試日期編造成確切日期。
12. 選擇題作答後先確認正誤，再引導學生說明其選項與其他選項的對錯理由；不要立刻傾倒完整解析。
13. 申論題先帶學生審題：辨識人物、行為、時間、法律關係與可能爭點，再形成答題骨架。理解追問只能確認一個關鍵判準，不能取代完整解題；完成一次追問與回饋後，應主動進入完整解題架構，再銜接考場擬答。學生明確要求「直接解題／進入完整解題／跳過追問」時，不得再反問；學生要求「開始／進入／生成考場擬答」時，必須直接交付完整擬答，不得只說明寫法、提供大綱或再次徵詢確認。
14. 不得把模型自行生成的題目冒充歷屆真題；只有題庫或教材中具有明確年度、題號與來源的內容，才能稱為真題。
15. 回覆使用純文字與自然換行，不要輸出 Markdown 星號、井號標題或反引號。
16. 維持學生信心：更正時先肯定學生察覺或已掌握的部分，再用一至兩句澄清並立即帶回下一個可完成的小步驟。不要長篇自責、反覆強調「我錯了／誤導你」，也不要把系統或檢索問題的焦慮丟給學生。
17. 教材搜尋結果必須同時符合「目前科目、今日任務、學生正在問的爭點」才可作為答案依據。僅有相同詞彙但屬於別科、別章或例外規定時，必須忽略，不得因搜尋到教材就硬套。
18. 學生質疑來源時，先重新核對問題與教材的直接關聯；若不直接相關，就簡短說明該段不適用，停止引用並回到正確主題。不要用不相關教材替先前說法辯護。
19. 排讀書計畫或拆解「重點考點」時，使用考點優先序：歷屆出題頻率、近五年趨勢、學生錯題／弱點、距離考試時間。不得只因高頻就跳過基礎前置概念；不得虛構題數、年份或星等。沒有可驗證統計時，明確標示為教材／教學判斷。
20. 每個重點應能回答：考什麼、先備概念、常見出題型態、易錯陷阱、要練哪一類真題。規劃任務時在 details 簡短標示「核心高頻」「個人弱點」或「間隔複習」等安排理由。
21. 必須先直接回答學生本輪提出的問題，再決定是否需要追問；不得只評價學生、改寫問題或另出反事實題來取代回答。資料已足夠時直接作成判斷，每輪最多追加一個真正必要、且學生能直接回答的追問。
22. 嚴禁把題目沒有提供的事實當成既定事實。需要檢驗額外事實時，必須明確使用「若……則……；反之……」分支，或先詢問學生，不得自行補入行為人的動機、認知、信賴、因果或實際使用情形。
23. 刑法共犯問題必須依序分層判斷：先判斷是否具有共同犯意與功能性犯罪支配，再判斷是否至少有物理或心理幫助，只有先前已成立正犯或共犯關係時，才討論共犯關係脫離及其效果。不得因正犯已著手，就直接推定另一人也具有犯罪支配。
24. 判斷心理幫助時，必須具體說明正犯是否知道該承諾或助力、該行為是否實際強化或維持犯意，以及實行時是否仍受其影響；未被使用的物理工具不得在欠缺上述事實時直接改稱心理幫助。
25. 不得無對話證據指責學生「反覆迴避」「又問一次」或虛構提問次數。更正應針對法律概念與涵攝本身，保持臺灣法律補教老師的精確、平和語氣，不使用羞辱、審問、挑釁或中國大陸式辯論用語。
26. 比較正犯、幫助犯與不罰時，應清楚交代使結論改變的事實節點與法律理由；「不可或缺」「離開現場」「著手時間」都只能作為判斷因素，不得未經涵攝直接等同犯罪支配、幫助因果或有效脫離。
27. 回答正文不得輸出任何網址、網域名稱或 Markdown 連結。外網查證只在系統的「查證來源」欄顯示來源名稱，正文引用時只寫「依全國法規資料庫」或「依司法院資料」等可讀名稱。
28. 司律首頁有明確服務範圍：法律學習、司律考試、真題／申論、讀書計畫、學習紀錄與本站功能操作。若學生詢問明顯無關的生活、天氣、旅遊、購物、娛樂、程式、一般醫療或其他非司律內容，請客氣、簡短地拒絕，不要回答該非法律問題，也不要為此搜尋外網。固定以類似「不好意思，我是司律備考的 AI 導師，主要協助法律學習與司律備考；這個問題和司律學習沒有直接關係，暫時無法協助。你可以改問法律概念、司律真題、申論、讀書計畫或平台操作。」回覆。若只是寒暄，可自然回應；若問題不明確，先以是否屬於司律學習判斷，不要過度拒絕。`;

function sourceNameFromUrl(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("law.moj.gov.tw")) return "全國法規資料庫";
  if (lower.includes("judicial.gov.tw")) return "司法院";
  if (lower.includes("moex.gov.tw")) return "考選部";
  return "外網查證來源";
}

function hideExternalUrls(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (_match, label: string, url: string) => {
      const cleanLabel = label.trim();
      return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+(?:\/\S*)?$/i.test(cleanLabel) ? sourceNameFromUrl(url) : cleanLabel;
    })
    .replace(/https?:\/\/[^\s)\]}>]+/gi, (url) => sourceNameFromUrl(url))
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    });
  }).join("").trim();
}

function extractAnthropicText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type?: string; text?: string } => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

function extractAnthropicError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Claude Sonnet 回覆失敗";
  const error = (payload as { error?: unknown }).error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message).slice(0, 300);
  }
  return "Claude Sonnet 回覆失敗";
}

function extractFileSearchContext(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  const rows: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "file_search_call") continue;
    const results = (item as { results?: unknown[] }).results;
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const filename = String((result as { filename?: unknown }).filename ?? "").trim();
      const content = (result as { content?: unknown[] }).content;
      const text = Array.isArray(content)
        ? content.map((part) => part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : "").join(" ").trim()
        : String((result as { text?: unknown }).text ?? "").trim();
      if (text) rows.push(`${filename ? `【${filename}】` : "【教材索引片段】"}\n${text.slice(0, 1600)}`);
    }
  }
  return [...new Set(rows)].slice(0, 8).join("\n\n").slice(0, 10_000);
}

function anthropicMessages(modelMessages: ClientMessage[], imageDataUrl: string) {
  const transcript = modelMessages.map((message) => `${message.role === "mentor" ? "教練" : "學生"}：${message.text}`).join("\n\n");
  const content: Array<Record<string, unknown>> = [{ type: "text", text: transcript }];
  if (imageDataUrl) {
    const match = imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
  }
  return [{ role: "user", content }];
}

async function runAnthropicTutor(
  apiKey: string,
  model: string,
  instructions: string,
  modelMessages: ClientMessage[],
  imageDataUrl: string,
  sharedRetrievalContext: string,
) {
  const startedAt = Date.now();
  const sourceInstruction = sharedRetrievalContext
    ? `\n\n【本次共同教材檢索片段】\n${sharedRetrievalContext}\n這些片段是另一模型同次檢索取得的共同資料。只能依片段可確認內容回答；無法確認的章節或頁碼必須明確標示。`
    : "";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      // 深度引導教學通常需要完整說明「爭點—規範—涵攝—追問」；1800
      // tokens 會讓 Claude 在半句或半個段落停止，改用較寬的上限，並
      // 透過 stop_reason 把異常截斷狀態回傳給前台。
      max_tokens: 8000,
      system: `${instructions}${sourceInstruction}\n\n你是第二個獨立回答模型。請直接回答學生當下問題，不要提及模型比較、API 或內部檢索流程。`,
      messages: anthropicMessages(modelMessages, imageDataUrl),
    }),
  });
  const raw = await response.text();
  let payload: unknown = {};
  try { payload = JSON.parse(raw); } catch { /* handled below */ }
  if (!response.ok) throw new Error(`${extractAnthropicError(payload)}（HTTP ${response.status}）`);
  const reply = extractAnthropicText(payload);
  if (!reply) throw new Error("Claude Sonnet 未產生可顯示內容");
  const usage = payload && typeof payload === "object" ? (payload as { usage?: { input_tokens?: number; output_tokens?: number } }).usage : undefined;
  return {
    model: payload && typeof payload === "object" && typeof (payload as { model?: unknown }).model === "string" ? String((payload as { model: string }).model) : model,
    reply,
    inputTokens: Number(usage?.input_tokens ?? 0),
    outputTokens: Number(usage?.output_tokens ?? 0),
    durationMs: Math.max(0, Date.now() - startedAt),
    stopReason: payload && typeof payload === "object" && typeof (payload as { stop_reason?: unknown }).stop_reason === "string"
      ? String((payload as { stop_reason: string }).stop_reason)
      : null,
  };
}

function usedFileSearch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const output = (payload as { output?: unknown[] }).output;
  return Array.isArray(output) && output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "file_search_call");
}

function usedWebSearch(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const output = (payload as { output?: unknown[] }).output;
  return Array.isArray(output) && output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "web_search_call");
}

function shouldOfferHomeWebSearch(text:string,mode:"off"|"fallback"|"always"){
  if(mode==="off")return false;
  if(mode==="always")return true;
  const normalized=text.replace(/\s+/g,"");
  return /(查外網|查網路|上網查|外部查證|最新|目前現行|現行法|最近|今日|今年|修法|修正草案|新判決|最新裁判|新聞|網址|網站|官方公告|是否已經變更)/u.test(normalized);
}

function extractWebSources(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as string[];
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return [] as string[];
  const sources: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const annotations = (part as { annotations?: unknown[] }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object" || (annotation as { type?: string }).type !== "url_citation") continue;
        const title = String((annotation as { title?: unknown }).title ?? "外網來源").trim();
        if (title) sources.push(title);
      }
    }
  }
  return [...new Set(sources)].slice(0, 8);
}

function extractSources(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as string[];
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return [] as string[];
  const names: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const annotations = (part as { annotations?: unknown[] }).annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object" || (annotation as { type?: string }).type !== "file_citation") continue;
        const filename = (annotation as { filename?: unknown }).filename;
        if (typeof filename === "string" && filename.trim()) names.push(filename.trim());
      }
    }
  }
  return [...new Set(names)].slice(0, 5);
}

function extractFileSearchResultNames(payload: unknown) {
  if (!payload || typeof payload !== "object") return [] as string[];
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return [] as string[];
  const names: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "file_search_call") continue;
    const results = (item as { results?: unknown[] }).results;
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const filename = (result as { filename?: unknown }).filename;
      if (typeof filename === "string" && filename.trim()) names.push(filename.trim());
    }
  }
  return [...new Set(names)].slice(0, 5);
}

async function displayDocumentSourceNames(names: string[]) {
  if (!names.length) return [] as string[];
  try {
    const db = await getDb();
    const rows = await db.select({ fileName: documents.fileName, bookTitle: documents.bookTitle, processingResultJson: documents.processingResultJson }).from(documents);
    const comparable = (value: string) => (value.split("/").pop() ?? value).replace(/\.(?:pdf|jsonl|md|txt|docx|zip)$/iu, "").replace(/[\s._-]+/gu, "").toLowerCase();
    return [...new Set(names.map((name) => {
      const baseName = name.split("/").pop() ?? name;
      const normalized = comparable(name);
      const row = rows.find((candidate) => candidate.fileName === name || candidate.fileName === baseName || comparable(candidate.fileName) === normalized);
      return row ? documentDisplayTitleFromMetadata(row) : name.replace(/\.(?:pdf|jsonl|md|txt|docx|zip)$/i, "");
    }).filter(Boolean))].slice(0, 5);
  } catch {
    return [...new Set(names.map((name) => name.replace(/\.(?:pdf|jsonl|md|txt|docx|zip)$/i, "")).filter(Boolean))].slice(0, 5);
  }
}

function chooseModel(messages: ClientMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "student")?.text ?? "";
  if (/完整批改|申論批改|評分|逐段改寫|模擬閱卷/.test(latest)) return "gpt-5.6-sol";
  if (latest.length > 500 || /深入分析|學說比較|實務見解|判決分析|完整涵攝|爭點整理/.test(latest)) return "gpt-5.6-terra";
  return "gpt-5.6-luna";
}

function inferSubject(text: string) {
  if (/刑法/.test(text)) return "刑法";
  if (/刑事訴訟法|刑訴/.test(text)) return "刑事訴訟法";
  if (/民事訴訟法|民訴/.test(text)) return "民事訴訟法";
  if (/民法/.test(text)) return "民法";
  if (/憲法/.test(text)) return "憲法";
  if (/行政法/.test(text)) return "行政法";
  if (/公司法|商法|票據法|保險法|證券交易法/.test(text)) return "商事法";
  return "綜合";
}

function requestedMcqSubject(text: string) {
  const compact = text.replace(/\s+/g, "");
  const asksForQuestion = /(?:一試|選擇題|單選題|真題|考古題|題庫)/.test(compact)
    || /(?:考我|測我|出題|來一題|練一題|做一題)/.test(compact);
  if (!asksForQuestion) return null;
  if (!/(?:找|給|出|練|做|來|抽|考|測|隨機|題庫|有沒有|是否有|開始)/.test(compact)) return null;
  if (/刑事訴訟法|刑訴/.test(compact)) return "刑事訴訟法";
  if (/民事訴訟法|民訴/.test(compact)) return "民事訴訟法";
  if (/刑法/.test(compact)) return "刑法";
  if (/民法/.test(compact)) return "民法";
  if (/憲法|行政法|公法/.test(compact)) return /憲法/.test(compact) ? "憲法" : /行政法/.test(compact) ? "行政法" : "公法";
  if (/公司法|保險法|證券交易法|票據法|商法|商事法/.test(compact)) return "商事法";
  return /一試|選擇題|單選題/.test(compact) ? "" : null;
}

async function findPublishedMcq(subject: string) {
  const db = await getDb();
  const filters = [eq(examQuestions.status, "published"), eq(examQuestions.examType, "mcq")];
  if (subject) {
    const subjectNeedle = subject === "商事法" ? "商" : subject === "公法" ? "公法" : subject;
    filters.push(sql`${examQuestions.subject} like ${`%${subjectNeedle}%`}`);
  }
  const candidates = await db.select().from(examQuestions).where(and(...filters)).orderBy(sql`random()`).limit(80);
  for (const question of candidates) {
    const options = normalizeMcqOptions(question.optionsJson);
    if (!options) continue;
    return { id: question.id, examType: "mcq" as const, year: question.year, examName: question.examName, subject: question.subject, questionNumber: question.questionNumber, stem: question.stem, options };
  }
  return null;
}

const modelRates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.10, cached: 0.01, output: 0.60 },
  "gpt-5.6-terra": { input: 1.00, cached: 0.10, output: 6.00 },
  "gpt-5.6-sol": { input: 2.50, cached: 0.25, output: 15.00 },
  "deepseek-v4-pro": { input: 0.435, cached: 0.003625, output: 0.87 },
};

function anthropicRates(model: string) {
  if (/opus/i.test(model)) return { input: 5, output: 25 };
  if (/haiku/i.test(model)) return { input: 1, output: 5 };
  if (/sonnet-5/i.test(model)) return { input: 2, output: 10 };
  return { input: 3, output: 15 };
}

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const inputTokens = Number(usage?.input_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? 0);
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : null;
  const cachedTokens = Number(details?.cached_tokens ?? 0);
  return { inputTokens, outputTokens, cachedTokens };
}

type PlanCall = { title: string; target_label: string; daily_minutes: number; tasks: Array<{ date: string; subject: string; title: string; duration_minutes: number; details: string }> };
type DeletePlanCall = { mode: "duplicates" | "title"; title: string; date: string; subject: string };

function readPlanCall(payload: unknown): PlanCall | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return null;
  const call = output.find((item) => item && typeof item === "object" && (item as { type?: string; name?: string }).type === "function_call" && (item as { name?: string }).name === "save_study_plan") as { arguments?: string } | undefined;
  if (!call?.arguments) return null;
  try { return JSON.parse(call.arguments) as PlanCall; } catch { return null; }
}

function readDeleteCall(payload: unknown): DeletePlanCall | null {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return null;
  const call = output.find((item) => item && typeof item === "object" && (item as { type?: string; name?: string }).type === "function_call" && (item as { name?: string }).name === "delete_study_tasks") as { arguments?: string } | undefined;
  if (!call?.arguments) return null;
  try { return JSON.parse(call.arguments) as DeletePlanCall; } catch { return null; }
}

function normalizedTaskPart(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。,、:：·・\-_—]/g, "");
}

function previousDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString().slice(0, 10);
}

function resolvedSessionDate(session: { sessionDate?: string | null; createdAt: Date; updatedAt: Date }) {
  return session.sessionDate || taipeiDate(session.updatedAt || session.createdAt);
}

async function deletePlanTasks(command: DeletePlanCall) {
  const db = await getDb();
  const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
  if (!plan) return { count: 0, titles: [] as string[] };
  const tasks = await db.select().from(studyTasks).where(eq(studyTasks.planId, plan.id)).orderBy(asc(studyTasks.id));
  let targets = tasks;
  if (command.mode === "duplicates") {
    const seen = new Set<string>();
    targets = tasks.filter((task) => {
      const key = `${task.taskDate}|${normalizedTaskPart(task.subject)}|${normalizedTaskPart(task.title)}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  } else {
    const title = normalizedTaskPart(command.title);
    targets = tasks.filter((task) => normalizedTaskPart(task.title) === title && (!command.date || task.taskDate === command.date) && (!command.subject || normalizedTaskPart(task.subject) === normalizedTaskPart(command.subject)));
  }
  for (const task of targets) await db.delete(studyTasks).where(eq(studyTasks.id, task.id));
  return { count: targets.length, titles: targets.slice(0, 5).map((task) => `${task.taskDate} ${task.subject}／${task.title}`) };
}

function taskConflictsWithSubject(task: PlanCall["tasks"][number], subject: string) {
  const text = `${task.subject} ${task.title} ${task.details}`;
  const otherSubjects: Record<string, RegExp> = {
    刑法: /民法|民事訴訟|刑事訴訟|刑訴|法學緒論|憲法|行政法|公司法|證券交易法|保險法|票據法/,
    刑事訴訟法: /民法|民事訴訟|民訴|法學緒論|憲法|行政法|公司法|證券交易法|保險法|票據法/,
    民法: /刑法|刑事訴訟|刑訴|民事訴訟|民訴|法學緒論|憲法|行政法|公司法|證券交易法|保險法|票據法/,
    民事訴訟法: /刑法|刑事訴訟|刑訴|法學緒論|憲法|行政法|公司法|證券交易法|保險法|票據法/,
    憲法: /刑法|刑事訴訟|刑訴|民法|民事訴訟|民訴|法學緒論|行政法|公司法|證券交易法|保險法|票據法/,
    行政法: /刑法|刑事訴訟|刑訴|民法|民事訴訟|民訴|法學緒論|憲法|公司法|證券交易法|保險法|票據法/,
    商事法: /刑法|刑事訴訟|刑訴|民法總則|民事訴訟|民訴|法學緒論|憲法|行政法/,
  };
  return task.subject !== subject || (otherSubjects[subject]?.test(text) ?? true);
}

function taskConflictsWithScope(task: PlanCall["tasks"][number], scope: string) {
  if (!scope || scope === "全科") return false;
  const text = `${task.title} ${task.details}`;
  const oppositeScopes: Record<string, RegExp> = {
    刑法總則: /刑法分則/,
    刑法分則: /刑法總則/,
    民法總則: /債法|物權|親屬|繼承/,
    債法: /民法總則|物權|親屬|繼承/,
    物權: /民法總則|債法|親屬|繼承/,
    親屬: /民法總則|債法|物權|繼承/,
    繼承: /民法總則|債法|物權|親屬/,
  };
  return oppositeScopes[scope]?.test(text) ?? false;
}

async function savePlan(plan: PlanCall, constraint: PlanningConstraint | null) {
  const db = await getDb();
  const days = Math.max(1, Math.min(30, Number(constraint?.days) || 7));
  const dailyMinutes = Math.max(30, Math.min(720, Number(constraint?.dailyMinutes) || Number(plan.daily_minutes) || 120));
  const firstDate = taipeiDate();
  const lastDateValue = new Date(`${firstDate}T12:00:00+08:00`);
  lastDateValue.setDate(lastDateValue.getDate() + days - 1);
  const lastDate = taipeiDate(lastDateValue);
  const candidates = plan.tasks.slice(0, days * 3).filter((task) => /^\d{4}-\d{2}-\d{2}$/.test(task.date) && task.date >= firstDate && task.date <= lastDate);
  const dayTotals = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const tasks = candidates.flatMap((task) => {
    const count = dayCounts.get(task.date) ?? 0;
    const used = dayTotals.get(task.date) ?? 0;
    const remaining = dailyMinutes - used;
    if (count >= 3 || remaining < 15) return [];
    const duration = Math.min(90, remaining, Math.max(15, Number(task.duration_minutes) || 30));
    dayCounts.set(task.date, count + 1);
    dayTotals.set(task.date, used + duration);
    return [{ ...task, duration_minutes: duration }];
  });
  if (!tasks.length) throw new Error("AI 沒有產生符合規劃期間與每日時間限制的任務，原行程已保留");
  if (constraint?.mode === "single") {
    const invalid = tasks.filter((task) => taskConflictsWithSubject(task, constraint.subject) || taskConflictsWithScope(task, constraint.scope));
    if (invalid.length) throw new Error(`AI 產生了非${constraint.subject}任務，已阻止寫入`);
  }
  const [active] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
  let planId: number;
  let replacedTasks = 0;
  if (constraint?.mode === "single" && constraint.replaceOnlySubject && active) {
    planId = active.id;
    const oldTasks = await db.select().from(studyTasks).where(and(eq(studyTasks.planId, active.id), eq(studyTasks.subject, constraint.subject)));
    replacedTasks = oldTasks.length;
    await db.delete(studyTasks).where(and(eq(studyTasks.planId, active.id), eq(studyTasks.subject, constraint.subject)));
    await db.update(studyPlans).set({ dailyMinutes }).where(eq(studyPlans.id, active.id));
  } else {
    if (active) replacedTasks = (await db.select().from(studyTasks).where(eq(studyTasks.planId, active.id))).length;
    if (active) await db.delete(studyTasks).where(eq(studyTasks.planId, active.id));
    await db.update(studyPlans).set({ active: false }).where(eq(studyPlans.active, true));
    const [created] = await db.insert(studyPlans).values({
      title: plan.title.slice(0, 120),
      targetLabel: plan.target_label.slice(0, 120),
      dailyMinutes,
    }).returning();
    planId = created.id;
  }
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = `${task.date}|${normalizedTaskPart(task.subject)}|${normalizedTaskPart(task.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.insert(studyTasks).values({
      planId,
      taskDate: task.date,
      subject: task.subject.slice(0, 40),
      title: task.title.slice(0, 120),
      durationMinutes: Math.max(10, Math.min(480, Number(task.duration_minutes) || 30)),
      details: (task.details ?? "").slice(0, 500),
    });
  }
  return { savedTasks: seen.size, replacedTasks };
}

async function getOrCreateSession(request: Request, requestedId: number | null, firstText: string, context: ChatContext) {
  const db = await getDb();
  const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
  const today = taipeiDate();
  const matchesContext = (candidate: { contextType: string; resourceId: number | null; segmentId: number | null }) => {
    if (candidate.contextType !== context.type || candidate.resourceId !== context.resourceId) return false;
    if (context.type === "book") return candidate.segmentId === context.segmentId;
    if (context.type === "my-course" || context.type === "public-course") return (candidate.segmentId ?? 0) === context.episodeId;
    return true;
  };
  if (requestedId) {
    const [existing] = await db.select().from(chatSessions).where(eq(chatSessions.id, requestedId)).limit(1);
    const sameContext = context.type === "home"
      ? existing?.contextType === "home" && resolvedSessionDate(existing) === today
      : Boolean(existing && matchesContext(existing));
    if (existing?.userKey === key && sameContext) {
      if (!existing.sessionDate) await db.update(chatSessions).set({ sessionDate: today }).where(eq(chatSessions.id, existing.id));
      return { ...existing, sessionDate: today };
    }
  }
  const sessions = await db.select().from(chatSessions).where(eq(chatSessions.userKey, key)).orderBy(desc(chatSessions.updatedAt)).limit(240);
  const todaySession = context.type === "home"
    ? sessions.find((candidate) => candidate.contextType === "home" && resolvedSessionDate(candidate) === today && candidate.progressStatus === "active")
      ?? sessions.find((candidate) => candidate.contextType === "home" && resolvedSessionDate(candidate) === today)
    : sessions.find((candidate) => matchesContext(candidate));
  if (todaySession) {
    if (!todaySession.sessionDate) await db.update(chatSessions).set({ sessionDate: today }).where(eq(chatSessions.id, todaySession.id));
    return { ...todaySession, sessionDate: today };
  }
  const [created] = await db.insert(chatSessions).values(context.type === "book" ? {
    userKey: key,
    sessionDate: today,
    title: `書籍｜${context.resourceTitle}｜${context.segmentTitle}`.slice(0, 180),
    contextType: "book",
    resourceId: context.resourceId,
    segmentId: context.segmentId,
  } : context.type === "magazine" ? {
    userKey: key,
    sessionDate: today,
    title: `法教專區｜${context.resourceTitle}`.slice(0, 180),
    contextType: "magazine",
    resourceId: context.resourceId,
  } : (context.type === "my-course" || context.type === "public-course") ? {
    userKey: key,
    sessionDate: today,
    title: `${context.type === "public-course" ? "開放課" : "我的課"}｜${context.resourceTitle}｜${context.episodeTitle}`.slice(0, 180),
    contextType: context.type,
    resourceId: context.resourceId,
    segmentId: context.episodeId,
  } : { userKey: key, sessionDate: today, title: `${today}｜${firstText.slice(0, 48) || "司律備考對話"}`, contextType: "home" }).returning();
  return created;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: ClientMessage[]; sessionId?: number | null; imageDataUrl?: string; planningConstraint?: PlanningConstraint; context?: ChatContext; visibleStudentText?: string; modelMode?: string; teachingLevel?: TeachingLevel; teacherFeedback?: boolean; persistStudentMessage?: boolean; requestKey?:string; professionalVerification?: boolean };
    const requestedMode = String(body.modelMode ?? "auto");
    const allowedModes: ChatModelMode[] = ["auto", "luna", "sol", "sonnet", "deepseek", "glm", "glm52", "compare-luna-sonnet", "compare-luna-glm52", "compare-luna-deepseek", "compare-sonnet-deepseek", "compare-luna-sonnet-deepseek"];
    let modelMode: ChatModelMode = allowedModes.includes(requestedMode as ChatModelMode) ? requestedMode as ChatModelMode : "auto";
    const messages = compactConversation(Array.isArray(body.messages) ? body.messages.slice(-30) : [], 6, 1200);
    if (!messages.length) return Response.json({ error: "缺少對話內容" }, { status: 400 });
    const latestStudent = [...messages].reverse().find((message) => message.role === "student" || message.role === "scholar");
    const rawContext = body.context;
    const context: ChatContext = rawContext?.type === "book" && Number.isInteger(rawContext.resourceId) && Number.isInteger(rawContext.segmentId)
      ? { type: "book", resourceId: rawContext.resourceId, segmentId: rawContext.segmentId, resourceTitle: String(rawContext.resourceTitle || "教材"), segmentTitle: String(rawContext.segmentTitle || "目前章節") }
      : rawContext?.type === "magazine" && Number.isInteger(rawContext.resourceId)
        ? { type: "magazine", resourceId: rawContext.resourceId, resourceTitle: String(rawContext.resourceTitle || "法學教室") }
        : (rawContext?.type === "my-course" || rawContext?.type === "public-course") && Number.isInteger(rawContext.resourceId)
          ? { type: rawContext.type, resourceId: rawContext.resourceId, episodeId: Number.isInteger(rawContext.episodeId) ? rawContext.episodeId : 0, resourceTitle: String(rawContext.resourceTitle || (rawContext.type === "public-course" ? "開放課" : "我的課")), episodeTitle: String(rawContext.episodeTitle || "目前這一集") }
          : { type: "home" };
    // 首頁是正式學習入口，固定使用 Luna 單模型。忽略舊偏好或前端送來的
    // 比較模式，避免已保存的測試設定繼續觸發 Sol／Claude／其他供應商。
    if (context.type === "home") modelMode = "luna";
    // 重新規劃計畫的提示可能包含「一試刷題」等學習目標，不能被首頁
    // 的一試抽題分流提前攔截；有 planningConstraint 時必須進入計畫流程。
    if (context.type === "home" && latestStudent && !body.planningConstraint && shouldRefuseHomeQuery(latestStudent.text)) {
      const reply = "不好意思，我是司律備考的 AI 導師，主要協助法律學習與司律備考；這個問題和司律學習沒有直接關係，暫時無法協助。你可以改問法律概念、司律真題、申論、讀書計畫或平台操作。";
      const session = await getOrCreateSession(request, Number(body.sessionId) || null, latestStudent.text, context);
      const db = await getDb();
      if (body.persistStudentMessage !== false && latestStudent.text.trim()) {
        await db.insert(chatMessages).values({ sessionId: session.id, role: "student", text: latestStudent.text.trim() });
      }
      await db.insert(chatMessages).values({ sessionId: session.id, role: "mentor", text: reply, source: "服務範圍" });
      await db.update(chatSessions).set({ updatedAt: new Date(), summary: reply, progressStatus: "active" }).where(eq(chatSessions.id, session.id));
      return Response.json({ reply, sessionId: session.id, citationStatus: "scope_refusal" });
    }
    const mcqSubject = context.type === "home" && !body.planningConstraint && latestStudent ? requestedMcqSubject(latestStudent.text) : null;
    if (mcqSubject !== null) {
      const practiceQuestion = await findPublishedMcq(mcqSubject);
      const session = await getOrCreateSession(request, Number(body.sessionId) || null, latestStudent?.text ?? "一試真題練習", context);
      const reply = practiceQuestion
        ? `已從「練真題」的已發布一試題庫抽出${mcqSubject ? `一題${mcqSubject}` : "一題"}真題。請直接在題目卡選 A、B、C 或 D；作答前不會顯示答案。`
        : `「練真題」目前沒有找到符合${mcqSubject ? `「${mcqSubject}」` : "條件"}且已發布、選項完整的一試真題。這是題庫篩選結果，不是教材搜尋結果。`;
      const db = await getDb();
      if (body.persistStudentMessage !== false && latestStudent?.text.trim()) {
        await db.insert(chatMessages).values({ sessionId: session.id, role: "student", text: latestStudent.text.trim() });
      }
      const storedReply = practiceQuestion
        ? `${reply}\n\n<!--SILU_PRACTICE:${Buffer.from(JSON.stringify(practiceQuestion), "utf8").toString("base64url")}-->`
        : reply;
      await db.insert(chatMessages).values({ sessionId: session.id, role: "mentor", text: storedReply, source: practiceQuestion ? "真題庫" : null });
      await db.update(chatSessions).set({ updatedAt: new Date(), summary: reply, progressStatus: "active" }).where(eq(chatSessions.id, session.id));
      return Response.json({ reply, practiceQuestion, sessionId: session.id, citationStatus: "exam_bank" });
    }
    const bookEvidence = context.type === "book" ? await readBookTeachingEvidence(context, latestStudent?.text ?? "") : null;
    const aiGate = await prepareAiUse(request, "law");
    if (aiGate instanceof Response) return aiGate;
    const externalCatalogEvidence = context.type === "home" ? await readExternalCatalogEvidence(latestStudent?.text ?? "") : "";
    const route = modelMode === "auto" ? automaticRoute(latestStudent?.text ?? "", context, bookEvidence?.status === "verified") : null;
    if (route) modelMode = route.provider;
    const providers = activeProviders(modelMode);
    const isComparison = providers.length > 1;
    const needsOpenAi = providers.includes("luna") || providers.includes("sol");
    const needsAnthropic = providers.includes("sonnet");
    const needsDeepSeek = providers.includes("deepseek");
    const needsZai = providers.includes("glm") || providers.includes("glm52");
    const apiKey = needsOpenAi ? await getOpenAIKey() : "";
    if (needsOpenAi && !apiKey) {
      return Response.json({ error: "OPENAI_API_KEY 尚未設定於司律備考的伺服器環境" }, { status: 503 });
    }
    const deepSeekKey = needsDeepSeek ? await getDeepSeekKey() : "";
    if (needsDeepSeek && !deepSeekKey) {
      return Response.json({ error: "DEEPSEEK_API_KEY 尚未設定於司律備考的伺服器環境" }, { status: 503 });
    }
    const zaiKey = needsZai ? await getZaiKey() : "";
    if (needsZai && !zaiKey) {
      return Response.json({ error: "ZAI_API_KEY 尚未設定於司律備考的伺服器環境" }, { status: 503 });
    }
    const anthropicKey = needsAnthropic ? await getAnthropicKey() : "";
    if (needsAnthropic && !anthropicKey) {
      return Response.json({ error: "ANTHROPIC_API_KEY 尚未設定於司律備考的伺服器環境" }, { status: 503 });
    }
    const imageDataUrl = typeof body.imageDataUrl === "string" && /^data:image\/jpeg;base64,/.test(body.imageDataUrl) && body.imageDataUrl.length <= 4_500_000 ? body.imageDataUrl : "";
    if (needsZai && imageDataUrl) {
      return Response.json({ error: "GLM 目前只測試文字對話；圖片題目請改選 Luna 或 Claude Sonnet。" }, { status: 400 });
    }
    if (providers.includes("glm52")) {
      const db = await getDb();
      const [spent] = await db.select({ micros: sql<number>`coalesce(sum(${usageLogs.estimatedCostUsdMicros}), 0)` }).from(usageLogs).where(eq(usageLogs.model, "glm-5.2"));
      if (Number(spent?.micros ?? 0) >= 2_000_000) {
        return Response.json({ error: "GLM-5.2 測試預算已達 US$2，系統已停止付費呼叫；可改選免費 GLM-4.7-Flash 或 Luna。" }, { status: 402 });
      }
    }
    const allowedPlanningSubjects = new Set(["刑法", "刑事訴訟法", "民法", "民事訴訟法", "憲法", "行政法", "商事法"]);
    const planningConstraint = body.planningConstraint?.mode === "single" && allowedPlanningSubjects.has(body.planningConstraint.subject)
      ? body.planningConstraint
      : body.planningConstraint?.mode === "all" ? body.planningConstraint : null;
    const session = await getOrCreateSession(request, Number(body.sessionId) || null, latestStudent?.text ?? "司律備考對話", context);
    let bookLearningRecord: { id: number; actualMinutes: number; messageCount: number } | null = null;
    let persistedCourseMessages: ClientMessage[] = [];
    if (context.type === "my-course" || context.type === "public-course") {
      const db = await getDb();
      const previous = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session.id)).orderBy(asc(chatMessages.id)).limit(20);
      persistedCourseMessages = previous
        .filter((message) => message.role === "student" || message.role === "mentor")
        .map((message) => ({ role: message.role as ClientMessage["role"], text: message.text }));
    }
    const storedStudentText = body.persistStudentMessage === false
      ? ""
      : context.type === "home"
        ? (latestStudent?.text ?? "")
        : String(body.visibleStudentText ?? "").trim();
    if (storedStudentText) {
      const db = await getDb();
      await db.insert(chatMessages).values({ sessionId: session.id, role: "student", text: storedStudentText });
      await db.update(chatSessions).set({ updatedAt: new Date(), progressStatus: "active" }).where(eq(chatSessions.id, session.id));
    }
    const modelMessages = persistedCourseMessages.length && latestStudent
      ? [...persistedCourseMessages, latestStudent].slice(-12)
      : messages;

    let vectorStoreId = "";
    let homeWebSearchMode: "off" | "fallback" | "always" = "off";
    try {
      const db = await getDb();
      const settings = await db.select().from(appSettings).where(sql`${appSettings.key} in ('openai_vector_store_id', 'home_web_search_mode')`);
      vectorStoreId = settings.find((item) => item.key === "openai_vector_store_id")?.value ?? "";
      const configuredMode = settings.find((item) => item.key === "home_web_search_mode")?.value;
      if (configuredMode === "fallback" || configuredMode === "always") homeWebSearchMode = configuredMode;
    } catch { /* answer from model knowledge until the index is ready */ }

    const today = taipeiDate();
    const yesterday = previousDate(today);
    let planContext = "目前尚未建立讀書計畫。";
    let recordContext = "目前尚無學習紀錄。";
    let yesterdayContext = "昨天沒有可接續的學習紀錄。";
    try {
      const db = await getDb();
      const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.active, true)).limit(1);
      if (plan) {
        const tasks = await db.select().from(studyTasks).where(eq(studyTasks.planId, plan.id)).orderBy(asc(studyTasks.taskDate)).limit(30);
        planContext = `目前計畫：${plan.title}；目標：${plan.targetLabel}；每日 ${plan.dailyMinutes} 分鐘。任務：${tasks.map((task) => `${task.taskDate} ${task.subject}/${task.title}/${task.durationMinutes}分鐘/${task.status}`).join("；") || "尚無任務"}`;
      }
    } catch { /* the tutor can continue before plan storage is ready */ }
    try {
      const db = await getDb();
      const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
      const records = await db.select().from(studyRecords).where(eq(studyRecords.userKey, key)).orderBy(desc(studyRecords.createdAt)).limit(20);
      if (records.length) recordContext = `近期學習紀錄：${records.map((record) => `${record.recordDate} ${record.subject}/${record.title}/${record.activityType}/${record.actualMinutes}分鐘${record.correct === null ? "" : record.correct ? "/答對" : "/答錯"}${record.weakness ? `/弱點:${record.weakness}` : ""}${record.nextStep ? `/接續:${record.nextStep}` : ""}`).join("；")}`;
    } catch { /* continue without record context */ }
    try {
      const db = await getDb();
      const key = request.headers.get("oai-authenticated-user-email") ?? "default-owner";
      const sessions = await db.select().from(chatSessions).where(eq(chatSessions.userKey, key)).orderBy(desc(chatSessions.updatedAt)).limit(240);
      const yesterdaySession = sessions.find((candidate) => candidate.contextType === "home" && resolvedSessionDate(candidate) === yesterday);
      const yesterdayMessages = yesterdaySession ? await db.select().from(chatMessages).where(eq(chatMessages.sessionId, yesterdaySession.id)).orderBy(desc(chatMessages.id)).limit(12) : [];
      const yesterdayRecords = await db.select().from(studyRecords).where(and(eq(studyRecords.userKey, key), eq(studyRecords.recordDate, yesterday))).orderBy(desc(studyRecords.createdAt)).limit(20);
      const yesterdayTasks = planContext.includes("目前計畫") ? await db.select().from(studyTasks).where(and(eq(studyTasks.taskDate, yesterday), eq(studyTasks.status, "pending"))).limit(20) : [];
      const lastStudent = [...yesterdayMessages].reverse().find((message) => message.role === "student")?.text ?? "";
      const lastMentor = [...yesterdayMessages].reverse().find((message) => message.role === "mentor")?.text ?? "";
      const taskText = yesterdayTasks.length ? `未完成任務：${yesterdayTasks.map((task) => `${task.subject}/${task.title}`).join("、")}。` : "昨天沒有查到未完成任務。";
      const recordText = yesterdayRecords.length ? `昨天學習紀錄：${yesterdayRecords.map((record) => `${record.subject}/${record.title}/${record.actualMinutes}分鐘${record.weakness ? `/弱點:${record.weakness}` : ""}${record.nextStep ? `/接續:${record.nextStep}` : ""}`).join("；")}。` : "昨天沒有學習紀錄。";
      yesterdayContext = `${taskText}${recordText}${lastStudent ? `昨天學生最後提到：${lastStudent.slice(0, 240)}。` : ""}${lastMentor ? `昨天教練最後的接續提示：${lastMentor.slice(0, 360)}。` : ""}`;
    } catch { /* continue without yesterday context */ }
    const plannerRule = planningConstraint ? `\n這次要規劃 ${planningConstraint.days} 天，每天「所有任務合計」不得超過 ${planningConstraint.dailyMinutes} 分鐘；每一天安排 1 至 3 項，每項通常 20 至 90 分鐘，不得把每日總時間重複填在每一項任務。${planningConstraint.mode === "single" ? `唯一允許的科目是「${planningConstraint.subject}」，範圍是「${planningConstraint.scope}」。每一筆 task.subject 必須完全等於「${planningConstraint.subject}」，標題與內容不得出現其他法科或法學緒論。` : "請依弱點與考試重要性分配各科。"}` : "";
    const bookEvidenceInstruction = context.type === "book"
      ? bookEvidence?.status === "verified"
        ? bookEvidence.basis === "teacher_solution"
          ? `\n\n【本題老師解析／擬答（唯一的老師見解來源）】\n書名：${bookEvidence.resourceTitle}\n題型：${bookEvidence.segmentTitle}\n位置：${bookEvidence.pageStart ? `第 ${bookEvidence.pageStart}${bookEvidence.pageEnd && bookEvidence.pageEnd !== bookEvidence.pageStart ? `–${bookEvidence.pageEnd}` : ""} 頁` : "待核對"}\n老師解析／擬答原文：${bookEvidence.excerpt}\n\n這是解題書教學，不是一般知識問答。你的任務是忠實濃縮上方同一題的老師解析，不是重新作答或逐段重貼擬答。請嚴格遵守：\n1. 依老師原本的答題架構合併層級。原文中為了論證同一人物、同一罪名而展開的學說、著手時點、隔離犯等內容，屬該大爭點的「判斷關鍵」，不得各自升格成平行的大爭點。\n2. 第一層通常依行為人與罪名整理，原則上以 2 至 3 個大爭點為上限；只有老師原文明確採更多獨立罪名架構時才可超過。\n3. 每個大爭點只用 2 至 4 句白話說清楚「爭點、老師採取的判準、事實涵攝與結論」。不要在回答正文逐項重貼「老師原文依據」，因為介面下方已有「查看老師原文」。\n4. 次爭點以短列點放在所屬大爭點之下，例如「間接正犯的著手標準」「隔離犯的直接危險」，不得重複解釋相同事實。\n5. 最後必須用一句「結論」彙整每位行為人的罪責，至少包含「成立／不成立＋法條＋罪名＋犯罪型態」；涉及未遂、間接正犯、共同正犯、教唆或幫助時不得只寫基本罪名，也不得停在「已著手」「具有支配」等中間判斷。一般整理控制在 350 至 550 個繁體中文字，除非學生明確要求詳解。\n6. 上方原文沒有處理、但確有必要提醒的內容，只能放在最後獨立的「AI 延伸檢查」；沒有必要就省略。不得因題目出現某人物，就自行新增老師未討論的罪名。\n7. 頂尖學霸模式可在完整罪責結論之後提出一題「老師追問」。追問只改變一個決定性事實，優先提供 A／B／C 選項並要求用剛學到的判準簡短說理；每個核心爭點最多一次，不得連續反問。學生回答後，先用一至三句回饋，再主動進入完整解題架構。\n8. 若學生問老師怎麼看或要求整理本題，使用「老師解析的核心爭點」→各大爭點與判斷關鍵→「結論」的順序；不得使用「老師原文依據」「白話拆解」作為每段重複標題。\n9. 不得把無法由原文直接核對的主張包裝成老師見解；AI 額外內容必須明確標成「AI 延伸檢查」。\n10. 學生回答追問或要求直接解題後，完整解題架構固定依「爭點→判準→各說→評析→涵攝→明確結論」整理；只列老師原文實際處理的學說，沒有對立說時不得硬湊。作答順序原則上依老師解析，不得自行寫死先處理哪一位行為人。完成後以「完整解題架構已完成，可按『開始考場擬答』直接生成答案」收尾，不得再出第二題反事實問題。\n11. 學生要求進入擬答時，依老師解析直接寫成可落筆的完整申論答案，包含標題、法條、要件／學說、具體涵攝及各行為人的完整罪責結論；不得用追問、寫作建議、答題順序說明或「接下來可以」代替擬答。\n12. 不得補造題目事實或混淆行為主體。例如題目只說咖啡遭打翻，不得寫成「甲使咖啡打翻」。對不知情工具人的過失責任，須先依題目與老師原文判斷有無預見可能性及注意義務違反；若老師認定其無過失，必須明寫「欠缺注意義務違反」，再補充死亡結果未發生且過失未遂不罰，不得僅寫成「可能製造不容許風險」。`
          : `\n\n【本次已核對教材內容】\n書名：${bookEvidence.resourceTitle}\n章節：${bookEvidence.segmentTitle}\n分類：${bookEvidence.lessonLabel || "未標示"}\n頁碼：${bookEvidence.pageStart ? `第 ${bookEvidence.pageStart}${bookEvidence.pageEnd && bookEvidence.pageEnd !== bookEvidence.pageStart ? `–${bookEvidence.pageEnd}` : ""} 頁` : "待核對"}\n原文摘錄：${bookEvidence.excerpt}\n以上是本次唯一可直接作為教材依據的章節內容。回答時優先依此內容；若學生問到摘錄以外的細節，必須說明需要再查核，不得把一般知識冒充本章原文。`
        : `\n\n【教材核對狀態】\n目前只知道學生選了「${context.resourceTitle}／${context.segmentTitle}」，但系統尚未取得這一章足夠的原文。不得說「教材提到」「本章指出」或虛構頁碼；若要回答，只能明確標示為一般法律補充，並先告知教材原文尚未核對。`
      : "";
    const teachingLevelInstruction = externalCatalogEvidence + (body.teachingLevel === "beginner"
      ? `\n\n【本輪學生身分：法律小白】學生可能把「有意做出動作」與刑法上的故意責任混在一起，也可能因挫折而懷疑自己。先用一句話接住情緒，再用極白話但法律上精準的例子拆開概念。比喻必須對應本題的錯誤類型；若是誤想防衛，學生知道自己在攻擊人，只是誤認存在防衛情狀，不得錯講成以為打蚊子卻打到人的一般錯誤。最後只問一個能讓他重拾信心的小問題。`
      : body.teachingLevel === "intermediate"
        ? `\n\n【本輪學生身分：基礎考生】學生會背公式但可能把理論名稱當成完整涵攝。不要直接說可以拿滿分；指出他已寫對的骨架後，要求逐一帶入題目中的照明、時間、環境、攻擊手段、錯誤可避免性與結果因果關聯等實際事實。最後只問一個需要具體涵攝的問題。`
        : body.teachingLevel === "advanced"
          ? `\n\n【本輪學生身分：進階考生】學生會正面挑戰通說。不得用「通說如此」壓過異說；要沉著區分嚴格罪責理論與限縮法律效果罪責理論的理論位置、法律效果、可避免性判斷及價值取捨，包括保留故意犯責任與轉入過失犯檢驗的實質差異。最後只留一個足以推進學說辯論的問題。`
          : body.teachingLevel === "super"
            ? `\n\n【本輪學生身分：頂尖學霸】要求處理體系一致性、隱藏前提、反例、學說邊界與考場策略；發現概念偷換時直接精準指出。完整罪責結論後只用一個改變關鍵事實的高難度追問測試論證；學生回答後不得繼續連問，必須回到完整解題架構，接著進入模考擬答。`
            : "");
    const bookFlowGuardInstruction = context.type === "book" && bookEvidence?.basis === "teacher_solution"
      ? `\n\n【解題書互動與擬答最終檢核】
1. 學生按「開始審題」時，第一則回覆不得直接公布全部題型或核心爭點；先從題示事實引導學生辨認行為人關係或第一個決定性問題，學生回答後才逐步揭示法律名稱。
2. 學生採有學理依據但與老師不同的答案時，依序標示「你的答案在何種學說下可成立」「老師採說」「考場建議」，不得只用鼓勵語模糊正誤。
3. 生成考場擬答前，先在內部逐項列出老師原文的第一層標題、行為人順序、罪名順序與最終結論；輸出必須完全照此順序，不得自行重排，內部核對過程不顯示給學生。
4. 若老師認定不知情工具人欠缺過失，須直接寫欠缺預見可能性或注意義務違反，再補充結果未發生且過失未遂不罰；不得加入「縱認已製造不容許風險」等造成前後矛盾的句子。
5. 若本輪是 Sol 覆核，應逐項標示「保留」「修正」「補充」，並以老師原文為主要校準依據；不同見解只能標示為補充爭議，不得冒充老師採說。最後提供依老師順序整理的修正版。`
      : "";
    const teacherFeedbackInstruction = body.teacherFeedback && context.type === "book"
      ? "\n\n【追問後回饋並完成解題】AI 學霸剛剛已回答你上一個理解追問。先用一至三句指出已掌握之處與一個需要修正或補強之處；接著不要再提新問題，直接依老師原文整理完整解題架構，固定使用「爭點→判準→各說→評析→涵攝→明確結論」。結論必須寫出每位行為人的法條、罪名及未遂／間接正犯等犯罪型態。最後只銜接一句「接下來可進入模考擬答」，不得再出反事實題。"
      : "";
    let instructions = (context.type === "book"
      ? `${baseInstructions}\n\n這是獨立的書籍章節教學，不是首頁每日導師對話。只依目前書籍、章節與本章對話接續教學；不要提及首頁、今日任務、昨日對話或讀書計畫，也不得建立、修改或刪除行事曆。${bookEvidenceInstruction}${bookFlowGuardInstruction}${teacherFeedbackInstruction}`
      : context.type === "magazine"
        ? `${baseInstructions}\n\n這是獨立的法學教室試讀文章問答，不是首頁每日導師對話。只根據目前期數、文章標題、摘要、核心爭點與學生框選的文字回答。若試讀內容不足以確認全文脈絡，必須明確標示限制，不得補造作者主張、判決內容或文章結論；不得建立、修改或刪除行事曆。`
        : context.type === "my-course" || context.type === "public-course"
          ? `${baseInstructions}\n\n這是「${context.type === "public-course" ? "開放課" : "我的課"}」的課程提問，不是平台已上傳字幕的課程。平台沒有讀取 YouTube 影片聲音、畫面或 SRT；你只能依課程名稱、集數名稱、學生提供的截圖、學生自行輸入的文字，以及可靠的一般法律知識回答。絕對不要說你看過影片、聽過老師講解或知道該影片的特定內容。你正在接續同一段課程對話：必須先閱讀前面 AI 的回答與學生回覆，再直接承接學生現在的追問，不要重新開一個主題。若學生問的是老師在影片中的特定說法，而問題沒有提供原文、截圖或足夠描述，請明確請學生貼上老師說法或畫面後再判斷。回答聚焦學生當下問題，不要建立、修改或刪除行事曆。`
      : `${baseInstructions}\n\n現在是台北時間 ${today}，目前時段應使用「${taipeiGreeting()}」；所有「今天、明天、明年」都必須以台北時間換算，不得使用伺服器時區。\n${planContext}\n${recordContext}\n昨天的學習接續資料（僅供本日對話參考）：${yesterdayContext}\n你必須根據學生實際完成狀態、作答正誤、延誤與新弱點調整後續計畫；不要重複已完成任務。若有下次接續點，優先從該處接著教。學生若選擇「繼續昨天進度」，先簡短確認昨天完成／未完成，再從未完成項目或最後接續點開始；若選擇「開始今天新單元」，直接進入今日任務；若選擇「考考我昨天學習成效」，先出一個可直接回答的小問題，不要先公布答案。\n重要：學生詢問「今天的讀書計畫、目前計畫、接下來要做什麼」時，必須直接依上方任務與學習紀錄逐項回答，絕對不可呼叫 save_study_plan。只有學生明確說要建立、重排、修改或調整計畫時，才可寫入新計畫。\n重要：學生明確要求刪除、移除或清理行事曆任務時，必須使用 delete_study_tasks；若要求處理重複行程，使用 mode=duplicates，只刪除每組重複中的後續項目並保留最早的一項。沒有明確刪除要求時禁止刪除。${plannerRule}`) + teachingLevelInstruction;
    if (context.type === "home" && body.professionalVerification === true) {
      instructions += "\n\n【AI 專業法學查證】學生已主動確認使用本功能，本次必須搜尋外網後再回答。第一順位只採司法院、全國法規資料庫、憲法法庭、考選部及政府機關；必要時才補充大學、出版社或作者官方頁面。回答必須完成四件事：列明官方來源與資料日期、整理查證結果、對照平台教材指出一致／已修正／可能過時、轉成考試可用的爭點／法條／判準／答題提醒。清楚區分法源原文、作者主張與 AI 整理，不得用搜尋摘要冒充原文。";
    }
    // 「Luna」是明確的單模型選擇，不得被環境變數或問題長度偷偷切換
    // 成 Terra／Sol；只有使用者選擇雙模型比較時，才另外呼叫 Claude。
    const selectedModel = providers.includes("sol") ? await getTeachingJudgeOpenAIModel("gpt-5.6-sol") : await getOpenAIModel("gpt-5.6-luna");
    const deepSeekModel = await getDeepSeekModel("deepseek-v4-pro");
    const zaiModel = providers.includes("glm52") ? "glm-5.2" : await getZaiModel("glm-4.7-flash");
    const tools: Array<Record<string, unknown>> = [{
      type: "function",
      name: "save_study_plan",
      description: "僅在學生明確要求建立、重排、修改或調整計畫時，將已確認的安排寫入行事曆；查詢目前計畫時禁止使用",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          target_label: { type: "string", description: "例如 116年律師考試；日期未公布時只寫目標月份" },
          daily_minutes: { type: "integer" },
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 90,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                date: { type: "string", description: "YYYY-MM-DD" },
                subject: planningConstraint?.mode === "single" ? { type: "string", enum: [planningConstraint.subject] } : { type: "string" },
                title: { type: "string" },
                duration_minutes: { type: "integer" },
                details: { type: "string" },
              },
              required: ["date", "subject", "title", "duration_minutes", "details"],
            },
          },
        },
        required: ["title", "target_label", "daily_minutes", "tasks"],
      },
    }];
    tools.push({
      type: "function",
      name: "delete_study_tasks",
      description: "只有學生明確要求刪除、移除或清理行事曆時使用。mode=duplicates 會判斷同一天、同科目、同任務名稱的重複項目，保留最早建立的一項；mode=title 刪除指定名稱，可再用日期與科目縮小範圍。",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["duplicates", "title"] },
          title: { type: "string", description: "mode=title 時填寫完整任務名稱，其他模式填空字串" },
          date: { type: "string", description: "可填 YYYY-MM-DD；不指定時填空字串" },
          subject: { type: "string", description: "可填科目；不指定時填空字串" },
        },
        required: ["mode", "title", "date", "subject"],
      },
    });
    // A verified local chapter is already scoped to the selected resource and
    // segment. Do not add the global vector store in that case: an unscoped
    // file_search result could silently teach from another book or chapter.
    const allowFileSearch = needsOpenAi && Boolean(vectorStoreId) && !(context.type === "book" && bookEvidence?.status === "verified");
    if (allowFileSearch) tools.unshift({
      type: "file_search",
      vector_store_ids: [vectorStoreId],
      max_num_results: 8,
      ...(context.type === "home" ? { filters: { type: "and", filters: [
        { type: "eq", key: "exam_category", value: "law" },
        { type: "eq", key: "homepage_enabled", value: true },
      ] } } : {}),
    });
    // 一般 AI 教練不會自動查外網。只有學生從獨立的「AI 專業法學查證」
    // 入口確認後才提供工具；每 5 輪仍最多使用一次，避免成本失控。
    const professionalVerificationRequested = context.type === "home" && body.professionalVerification === true;
    const professionalVerificationAvailable = professionalVerificationRequested ? await coachWebSearchAvailable(aiGate) : false;
    if (professionalVerificationRequested && homeWebSearchMode === "off") return Response.json({ error:"AI 專業法學查證目前未開放，請改用一般教材回答。",code:"PROFESSIONAL_VERIFICATION_DISABLED" },{status:403});
    if (professionalVerificationRequested && !professionalVerificationAvailable) return Response.json({ error:"本組 5 輪的專業查證已使用；下一組開始後會重新提供 1 次。",code:"PROFESSIONAL_VERIFICATION_USED" },{status:429});
    const allowWebSearch = needsOpenAi && professionalVerificationRequested && professionalVerificationAvailable;
    if (allowWebSearch) tools.unshift({ type: "web_search" });
    let payload: unknown = {};
    let openAiPayload: unknown = {};
    let openAiDurationMs = 0;
    let openAiError = "";
    let deepSeekRun: { model: string; reply: string; inputTokens: number; outputTokens: number; durationMs: number } | null = null;
    let deepSeekError = "";
    let zaiRun: { model: string; reply: string; inputTokens: number; outputTokens: number; durationMs: number } | null = null;
    let zaiError = "";
    if (needsZai) {
      const startedAt = Date.now();
      const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${zaiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: zaiModel,
          messages: [{ role: "system", content: instructions }, ...modelMessages.map((message) => ({ role: message.role === "mentor" ? "assistant" : "user", content: message.text }))],
          thinking: { type: providers.includes("glm52") ? "enabled" : "disabled" },
          max_tokens: 4096,
          temperature: 0.7,
        }),
      });
      const raw = await response.text();
      let zaiPayload: { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } } = {};
      try { zaiPayload = JSON.parse(raw) as typeof zaiPayload; } catch { /* handled as a service error */ }
      if (!response.ok) {
        const zaiLabel = providers.includes("glm52") ? "GLM-5.2" : "GLM-4.7-Flash 免費模型";
        zaiError = response.status === 429 || response.status >= 500
          ? `${zaiLabel}目前繁忙，請稍後再試；本次沒有改用其他模型。`
          : `${zaiLabel}無法回應${zaiPayload.error?.message ? `：${zaiPayload.error.message.slice(0, 220)}` : ""}`;
      } else {
        zaiRun = {
          model: zaiPayload.model || zaiModel,
          reply: zaiPayload.choices?.[0]?.message?.content?.trim() || "",
          inputTokens: Number(zaiPayload.usage?.prompt_tokens ?? 0),
          outputTokens: Number(zaiPayload.usage?.completion_tokens ?? 0),
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }
    }
    if (needsDeepSeek) {
      const startedAt = Date.now();
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${deepSeekKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: deepSeekModel,
          messages: [{ role: "system", content: instructions }, ...modelMessages.map((message) => ({ role: message.role === "mentor" ? "assistant" : "user", content: message.text }))],
          thinking: { type: "enabled" },
          max_tokens: 4000,
        }),
      });
      payload = await response.json();
      if (!response.ok) deepSeekError = "DeepSeek V4-Pro 暫時無法回應";
      const deepPayload = payload as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      if (response.ok) {
        deepSeekRun = {
          model: deepPayload.model || deepSeekModel,
          reply: deepPayload.choices?.[0]?.message?.content?.trim() || "",
          inputTokens: Number(deepPayload.usage?.prompt_tokens ?? 0),
          outputTokens: Number(deepPayload.usage?.completion_tokens ?? 0),
          durationMs: Math.max(0, Date.now() - startedAt),
        };
      }
    }
    if (needsOpenAi) {
      const openAiStartedAt = Date.now();
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          instructions,
          input: modelMessages.map((message, index) => ({
            role: message.role === "mentor" ? "assistant" : "user",
            content: imageDataUrl && message.role === "student" && index === modelMessages.length - 1 ? [
              { type: "input_text", text: message.text },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ] : message.text,
          })),
          ...(allowFileSearch ? { include: ["file_search_call.results"] } : {}),
          tools,
          ...(planningConstraint ? { tool_choice: { type: "function", name: "save_study_plan" } } : {}),
        }),
      });

      payload = await response.json();
      openAiPayload = payload;
      if (!response.ok) openAiError = "Luna 暫時無法回應";
      openAiDurationMs = Math.max(0, Date.now() - openAiStartedAt);
    }
    const openAiReply = extractText(payload);
    let reply = providers.map((provider) => providerReply(provider, {
      luna: openAiReply,
      deepseek: deepSeekRun?.reply ?? "",
      zai: zaiRun?.reply ?? "",
    })).find(Boolean) ?? "";
    const planCall = readPlanCall(payload);
    const deleteCall = readDeleteCall(payload);
    let planSaved = false;
    let replacedTasks = 0;
    let planError = "";
    if (planCall) {
      try {
        const result = await savePlan(planCall, planningConstraint);
        replacedTasks = result.replacedTasks;
        if (result.savedTasks) {
          planSaved = true;
          reply = `${reply ? `${reply}\n\n` : ""}我已經把接下來 ${result.savedTasks} 項任務寫入你的讀書計畫。你可以打開行事曆查看，也可以隨時告訴我調整。`;
        }
      } catch (error) {
        planError = error instanceof Error ? error.message : "AI 規劃內容未通過科目檢查，沒有寫入行事曆。";
        reply = planError;
      }
    } else if (planningConstraint) {
      planError = openAiError || deepSeekError || zaiError || "AI 沒有回傳可寫入行事曆的計畫內容，原行程已保留。";
      reply = planError;
    }
    let tasksDeleted = 0;
    if (deleteCall) {
      try {
        const result = await deletePlanTasks(deleteCall);
        tasksDeleted = result.count;
        reply = `${reply ? `${reply}\n\n` : ""}${result.count ? `已刪除 ${result.count} 項行事曆任務。${result.titles.length ? `\n${result.titles.join("\n")}` : ""}` : "目前沒有找到符合條件的行事曆任務。"}`;
      } catch { /* keep the conversation available */ }
    }

    const searchedFiles = needsOpenAi && usedFileSearch(payload);
    const searchedWeb = needsOpenAi && usedWebSearch(payload);
    if(professionalVerificationRequested&&!searchedWeb)return Response.json({error:"本次未取得可核對的外網查證結果，因此不計入 AI 輪次；請稍後再試。",code:"PROFESSIONAL_VERIFICATION_FAILED"},{status:502});
    if(searchedWeb&&context.type==="home")await markCoachWebSearchUsed(aiGate);
    const webSources = searchedWeb ? extractWebSources(payload) : [];
    const citationSources = searchedFiles ? extractSources(payload) : [];
    const searchResultNames = searchedFiles ? extractFileSearchResultNames(payload) : [];
    const allSearchSources = [...new Set([...citationSources, ...searchResultNames])];
    const displaySearchSources = context.type === "home" && searchedFiles ? await displayDocumentSourceNames(allSearchSources) : allSearchSources;
    const sharedRetrievalContext = searchedFiles ? extractFileSearchContext(payload) : "";
    const comparisonClaudeModel = needsAnthropic ? await getAnthropicChatModel("claude-sonnet-5") : "";
    let claudeRun: { model: string; reply: string; inputTokens: number; outputTokens: number; durationMs: number; stopReason: string | null } | null = null;
    let claudeError = "";
    if (needsAnthropic) {
      try {
        claudeRun = await runAnthropicTutor(
          anthropicKey,
          comparisonClaudeModel,
          instructions,
          modelMessages,
          imageDataUrl,
          sharedRetrievalContext,
        );
      } catch (error) {
        claudeError = error instanceof Error ? error.message.slice(0, 500) : "Claude Sonnet 回覆失敗";
      }
    }
    if (providers[0] === "sonnet") reply = claudeRun?.reply ?? "";
    if (!reply) reply = providers.map((provider) => providerReply(provider, {
      luna: openAiReply,
      deepseek: deepSeekRun?.reply ?? "",
      zai: zaiRun?.reply ?? "",
      sonnet: claudeRun?.reply ?? "",
    })).find(Boolean) ?? "";
    if (!reply) return Response.json({ error: zaiError || openAiError || deepSeekError || claudeError || "AI 未產生可顯示內容" }, { status: 502 });
    reply = hideExternalUrls(reply);

    const fileSearchConfirmedForBook = Boolean(
      context.type === "book" &&
      searchedFiles &&
      bookEvidence?.fileName &&
      allSearchSources.some((name) => name === bookEvidence.fileName),
    );
    const effectiveTeachingEvidence: TeachingEvidence | null = context.type === "book"
      ? bookEvidence?.status === "verified"
        ? bookEvidence.basis === "teacher_solution"
          ? {
              ...bookEvidence,
              message: "本次解題已鎖定同一題老師爭點解析／擬答，並以其作為主要教學依據。",
              matchedTerms: matchedEvidenceTerms(bookEvidence.excerpt, latestStudent?.text ?? "", reply),
            }
        : evidenceSupportKind(bookEvidence.excerpt, latestStudent?.text ?? "", reply) === "direct"
          ? {
              ...bookEvidence,
              message: "原文片段直接包含本次回答所使用的主要概念或判準。",
              matchedTerms: matchedEvidenceTerms(bookEvidence.excerpt, latestStudent?.text ?? "", reply),
            }
          : evidenceSupportKind(bookEvidence.excerpt, latestStudent?.text ?? "", reply) === "applied"
            ? {
                ...bookEvidence,
                status: "applied_inference",
                message: "教材原文提供法律判準；AI 依該判準套用到本題事實或罪名完成涵攝。",
                matchedTerms: matchedEvidenceTerms(bookEvidence.excerpt, latestStudent?.text ?? "", reply),
              }
          : {
              ...bookEvidence,
              status: "full_text_search",
              message: "已找到相關章節原文，但目前片段不足以直接支持本次回答；不得視為已核對。",
              matchedTerms: matchedEvidenceTerms(bookEvidence.excerpt, latestStudent?.text ?? "", reply),
            }
        : fileSearchConfirmedForBook
          ? {
              ...(bookEvidence ?? {
                status: "unavailable",
                retrieval: "none",
                resourceId: context.resourceId,
                segmentId: context.segmentId,
                resourceTitle: context.resourceTitle,
                segmentTitle: context.segmentTitle,
                lessonLabel: "",
                pageStart: null,
                pageEnd: null,
                fileName: "",
                excerpt: "",
                message: "",
              }),
              status: "full_text_search",
              retrieval: "full_text_search",
              excerpt: "本次由全文索引命中；章節與頁碼仍需人工核對。",
              message: "已命中教材全文索引，但尚未確認這段內容是否屬於目前章節。",
            }
          : bookEvidence
      : null;
    const sources = context.type === "book"
      ? effectiveTeachingEvidence?.status === "verified" || effectiveTeachingEvidence?.status === "applied_inference"
        ? [`${effectiveTeachingEvidence.resourceTitle}｜${effectiveTeachingEvidence.segmentTitle}`]
      : effectiveTeachingEvidence?.status === "full_text_search"
          ? [effectiveTeachingEvidence.resourceTitle || "教材全文索引（章節待核對）"]
          : []
      : [...new Set([...displaySearchSources, ...webSources])];
    const fromFiles = context.type === "book"
      ? effectiveTeachingEvidence?.status === "verified" || effectiveTeachingEvidence?.status === "applied_inference" || effectiveTeachingEvidence?.status === "full_text_search"
      : searchedFiles && (citationSources.length > 0 || searchResultNames.length > 0);
    const citationStatus = context.type === "book"
      ? effectiveTeachingEvidence?.status ?? "unavailable"
      : searchedWeb && webSources.length ? "web_search" : searchedFiles && sources.length ? "full_text_search" : "unavailable";
    const openAiUsage = needsOpenAi ? readUsage(openAiPayload) : { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    const openAiRates = modelRates[selectedModel] ?? modelRates["gpt-5.6-luna"];
    const modelTokenCostUsd = needsOpenAi
      ? (Math.max(0, openAiUsage.inputTokens - openAiUsage.cachedTokens) * openAiRates.input + openAiUsage.cachedTokens * openAiRates.cached + openAiUsage.outputTokens * openAiRates.output) / 1_000_000
      : 0;
    const fileSearchCostUsd = searchedFiles ? 0.0025 : 0;
    const webSearchCostUsd = searchedWeb ? 0.01 : 0;
    const openAiCostUsd = needsOpenAi
      ? modelTokenCostUsd + fileSearchCostUsd + webSearchCostUsd
      : 0;
    const deepSeekUsage = deepSeekRun
      ? { inputTokens: deepSeekRun.inputTokens, cachedTokens: 0, outputTokens: deepSeekRun.outputTokens }
      : { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    const deepSeekCostUsd = deepSeekRun
      ? (deepSeekRun.inputTokens * modelRates["deepseek-v4-pro"].input + deepSeekRun.outputTokens * modelRates["deepseek-v4-pro"].output) / 1_000_000
      : 0;
    const claudePricing = anthropicRates(claudeRun?.model || comparisonClaudeModel);
    const claudeCostUsd = claudeRun
      ? (claudeRun.inputTokens * claudePricing.input + claudeRun.outputTokens * claudePricing.output) / 1_000_000
      : 0;
    const zaiCostUsd = zaiRun && providers.includes("glm52")
      ? (zaiRun.inputTokens * 1.4 + zaiRun.outputTokens * 4.4) / 1_000_000
      : 0;
    const modelResults = providers.map((provider) => {
      if (provider === "luna" || provider === "sol") return {
        provider,
        providerName: "openai",
        model: selectedModel,
        label: providerLabel(provider),
        text: openAiReply,
        inputTokens: openAiUsage.inputTokens,
        cachedTokens: openAiUsage.cachedTokens,
        outputTokens: openAiUsage.outputTokens,
        estimatedCostUsd: openAiCostUsd,
        durationMs: openAiDurationMs,
        error: openAiError || (!openAiReply ? `${providerLabel(provider)} 未產生可顯示內容` : ""),
        stopReason: null as string | null,
      };
      if (provider === "deepseek") return {
        provider,
        providerName: "deepseek",
        model: deepSeekRun?.model || deepSeekModel,
        label: providerLabel(provider),
        text: deepSeekRun?.reply || "",
        inputTokens: deepSeekUsage.inputTokens,
        cachedTokens: deepSeekUsage.cachedTokens,
        outputTokens: deepSeekUsage.outputTokens,
        estimatedCostUsd: deepSeekCostUsd,
        durationMs: deepSeekRun?.durationMs ?? 0,
        error: deepSeekError || (!deepSeekRun?.reply ? "DeepSeek V4-Pro 未產生可顯示內容" : ""),
        stopReason: null as string | null,
      };
      if (provider === "glm" || provider === "glm52") return {
        provider,
        providerName: "zai",
        model: zaiRun?.model || zaiModel,
        label: providerLabel(provider),
        text: zaiRun?.reply || "",
        inputTokens: zaiRun?.inputTokens ?? 0,
        cachedTokens: 0,
        outputTokens: zaiRun?.outputTokens ?? 0,
        estimatedCostUsd: zaiCostUsd,
        durationMs: zaiRun?.durationMs ?? 0,
        error: zaiError || (!zaiRun?.reply ? `${provider === "glm52" ? "GLM-5.2" : "GLM-4.7-Flash"} 未產生可顯示內容` : ""),
        stopReason: null as string | null,
      };
      return {
        provider,
        providerName: "anthropic",
        model: claudeRun?.model || comparisonClaudeModel,
        label: providerLabel(provider),
        text: claudeRun?.reply || "",
        inputTokens: claudeRun?.inputTokens ?? 0,
        cachedTokens: 0,
        outputTokens: claudeRun?.outputTokens ?? 0,
        estimatedCostUsd: claudeCostUsd,
        durationMs: claudeRun?.durationMs ?? 0,
        error: claudeError || (!claudeRun?.reply ? "Claude Sonnet 未產生可顯示內容" : ""),
        stopReason: claudeRun?.stopReason ?? null,
      };
    });
    const primaryResult = modelResults[0];
    const primaryModel = primaryResult.model;
    const primaryUsage = { inputTokens: primaryResult.inputTokens, cachedTokens: primaryResult.cachedTokens, outputTokens: primaryResult.outputTokens };
    const primaryDurationMs = primaryResult.durationMs;
    const primaryEstimatedCostUsd = primaryResult.estimatedCostUsd;
    let comparison: Record<string, unknown> | null = null;
    try {
      const db = await getDb();
      for (const result of modelResults) {
        if (result.inputTokens || result.outputTokens || result.text) {
          await db.insert(usageLogs).values({
            model: result.model,
            source: isComparison ? `AI 導師模型比較（${result.label}）` : fromFiles ? "教材" : "AI 補充",
            inputTokens: result.inputTokens,
            cachedTokens: result.cachedTokens,
            outputTokens: result.outputTokens,
            fileSearchCalls: result.provider === "luna" && searchedFiles ? 1 : 0,
            estimatedCostUsdMicros: Math.round(result.estimatedCostUsd * 1_000_000),
          });
        }
      }
      if (isComparison) {
        const [comparisonRow] = await db.insert(chatComparisons).values({
          userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
          sessionId: session.id,
          contextType: context.type,
          promptText: latestStudent?.text ?? "",
          sourceStatus: citationStatus,
          sourceJson: JSON.stringify(sources),
        }).returning();
        const responseRows = await db.insert(chatComparisonResponses).values(modelResults.map((result) => ({
          comparisonId: comparisonRow.id,
          provider: result.providerName,
          model: result.model,
          label: result.label,
          text: result.text,
          source: fromFiles ? "教材" : "AI 補充",
          citationsJson: sources.length ? JSON.stringify(sources) : null,
          inputTokens: result.inputTokens,
          cachedTokens: result.cachedTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsdMicros: Math.round(result.estimatedCostUsd * 1_000_000),
          durationMs: result.durationMs,
          error: result.error || null,
        }))).returning();
        comparison = {
          id: comparisonRow.id,
          sourceStatus: citationStatus,
          responses: responseRows.map((row) => ({
            id: row.id,
            provider: row.provider,
            model: row.model,
            label: row.label,
            text: row.text,
            source: row.source,
            sources,
            error: row.error,
            usage: {
              inputTokens: row.inputTokens,
              cachedTokens: row.cachedTokens,
              outputTokens: row.outputTokens,
              estimatedCostUsd: row.estimatedCostUsdMicros / 1_000_000,
              durationMs: row.durationMs,
            },
            stopReason: modelResults.find((result) => result.label === row.label)?.stopReason ?? null,
          })),
        };
      }
      if (body.persistStudentMessage !== false) {
        await db.insert(chatMessages).values({
          sessionId: session.id,
          role: "mentor",
          text: reply,
          source: fromFiles ? "教材" : "AI 補充",
          citationsJson: sources.length ? JSON.stringify(sources) : null,
          citationStatus,
          comparisonJson: comparison ? JSON.stringify(comparison) : null,
          model: primaryModel,
          estimatedCostUsdMicros: Math.round(primaryEstimatedCostUsd * 1_000_000),
        });
        await db.update(chatSessions).set({ updatedAt: new Date(), summary: reply.replace(/\s+/g, " ").slice(0, 500), progressStatus: "active" }).where(eq(chatSessions.id, session.id));
      }
      if (context.type === "book") {
        bookLearningRecord = await syncBookLearningRecord({
          db,
          session,
          userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
          resourceTitle: context.resourceTitle,
          segmentTitle: context.segmentTitle,
        });
      }
      if (context.type === "home" && body.persistStudentMessage !== false && latestStudent && latestStudent.text.trim().length >= 6) {
        const learningMinutes = Math.min(30, Math.max(5, Math.ceil(latestStudent.text.trim().length / 80) * 5));
        await db.insert(studyRecords).values({
          userKey: request.headers.get("oai-authenticated-user-email") ?? "default-owner",
          recordDate: today,
          subject: inferSubject(latestStudent.text),
          title: `AI 對話｜${latestStudent.text.trim().slice(0, 72)}`,
          activityType: "AI 對話學習",
          actualMinutes: learningMinutes,
          reflection: `學生提問：${latestStudent.text.trim()}\n\n司律導師：${reply}`.slice(0, 12000),
          nextStep: reply.replace(/\s+/g, " ").slice(0, 180),
        });
      }
    } catch { /* usage logging must not block the learner */ }

    const aiAccess = context.type === "home"
      ? await finishAiCoachRound(aiGate,{action:"law_coach",description:"司律首頁 AI 教練引導",requestKey:body.requestKey})
      : await finishAiUse(aiGate, { action: "law_ask", description: "司律教材 AI 試問", requestKey:body.requestKey });
    return Response.json({
      reply,
      source: fromFiles ? "教材" : "AI 補充",
      usage: { model: primaryModel, ...primaryUsage, fileSearchCalls: (primaryResult.provider === "luna" || primaryResult.provider === "sol") && searchedFiles ? 1 : 0, webSearchCalls: (primaryResult.provider === "luna" || primaryResult.provider === "sol") && searchedWeb ? 1 : 0, modelTokenCostUsd: (primaryResult.provider === "luna" || primaryResult.provider === "sol") ? modelTokenCostUsd : primaryEstimatedCostUsd, fileSearchCostUsd: (primaryResult.provider === "luna" || primaryResult.provider === "sol") ? fileSearchCostUsd : 0, webSearchCostUsd: (primaryResult.provider === "luna" || primaryResult.provider === "sol") ? webSearchCostUsd : 0, durationMs: primaryDurationMs, estimatedCostUsd: primaryEstimatedCostUsd, routingReason: route?.reason ?? `測試模式由管理者手動指定 ${primaryResult.label}。` },
      planSaved,
      replacedTasks,
      error: planError || undefined,
      tasksDeleted,
      sources,
      citationStatus,
      teachingEvidence: effectiveTeachingEvidence,
      comparison,
      sessionId: session.id,
      bookLearningRecord,
      aiAccess,
    });
  } catch {
    return Response.json({ error: "對話處理失敗" }, { status: 500 });
  }
}
