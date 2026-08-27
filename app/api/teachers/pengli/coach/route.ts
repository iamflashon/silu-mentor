import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { documentAssignments, documentSearchUnits, documents, usageLogs } from "../../../../../db/schema";
import { estimateCostUsdMicros } from "../../../../../lib/usage";
import { getOpenAIKey, openAIJson } from "../../../../../lib/openai";
import { requireMember } from "../../../../../lib/member-auth";
import { finishAiCoachRound, prepareAiUse } from "../../../../../lib/ai-access-gate";
import { getAiPlan } from "../../../../../lib/ai-access";

type InputMessage = { role?: unknown; text?: unknown };

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => typeof item === "object" && item && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []).map((item) => typeof item === "object" && item && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n").trim();
}

function plainText(value: string) {
  return value.replace(/\*\*/gu, "").replace(/^#{1,6}\s*/gmu, "").replace(/^>\s?/gmu, "").trim();
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

async function pengliEvidence(query: string) {
  const db = await getDb("primary");
  const [directBook] = await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName })
    .from(documents)
    .where(or(like(documents.fileName, "%59ML170502%"), like(documents.bookTitle, "%行政法考點%")))
    .orderBy(desc(documents.id)).limit(1);
  const [assignedBook] = directBook ? [] : await db.select({ id: documents.id, title: documents.bookTitle, fileName: documents.fileName })
    .from(documentAssignments)
    .innerJoin(documents, eq(documents.id, documentAssignments.documentId))
    .where(and(eq(documentAssignments.examCategory, "pengli"), eq(documentAssignments.aiSearchEnabled, true)))
    .orderBy(desc(documents.id)).limit(1);
  const book = directBook ?? assignedBook;
  if (!book) return { documentId: null, title: "", rows: [] as Array<{ pageStart: number | null; pageEnd: number | null; title: string; hierarchyPath: string; text: string }> };

  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-Hant");
  const legalPhrases = [
    "禁止繼續使用擴音設施", "繼續使用擴音設施", "擴音設施", "噪音管制法",
    "行政法上請求權", "公法上請求權", "課予義務訴訟", "一般給付訴訟",
    "訴訟類型", "救濟程序", "行政處分", "請求權基礎", "公私法區分",
    "法律保留原則", "層級化法律保留", "明確性原則", "外部性",
  ].filter((phrase) => normalized.includes(phrase));
  const topicHints: string[] = [];
  if (/擴音|噪音|禁止繼續使用/u.test(normalized)) topicHints.push("禁止繼續使用擴音設施", "行政法上請求權", "訴訟類型", "課予義務訴訟");
  if (/公私法|請求權基礎|758/u.test(normalized)) topicHints.push("公私法區分", "請求權基礎", "新主體說", "758");
  if (/法律保留|443/u.test(normalized)) topicHints.push("法律保留原則", "層級化法律保留", "443");
  if (/明確性/u.test(normalized)) topicHints.push("明確性原則", "可理解", "可預見", "司法審查");
  if (/行政處分|外部性/u.test(normalized)) topicHints.push("行政處分", "外部性");
  const terms = [...new Set([
    ...legalPhrases,
    ...topicHints,
    ...normalized.split(/[\s、，。；：,.;:()（）？?！!「」『』]+/u)
      .map((term) => term.replace(/^(我正在學|請先用|一個問題|帶我判斷|請問|老師)/u, "").trim())
      .filter((term) => term.length >= 2 && term.length <= 18),
  ])].slice(0, 8);
  // D1 查詢只使用少量核心詞，避免學霸代答把整段對話展開成過長的 OR 條件。
  const conditions = terms.map((term) =>
    like(documentSearchUnits.normalizedText, `%${term}%`)
  );
  const rows = conditions.length ? await db.select({
    pageStart: documentSearchUnits.pageStart,
    pageEnd: documentSearchUnits.pageEnd,
    title: documentSearchUnits.title,
    hierarchyPath: documentSearchUnits.hierarchyPath,
    text: documentSearchUnits.text,
  }).from(documentSearchUnits)
    .where(and(eq(documentSearchUnits.documentId, book.id), or(...conditions)))
    .orderBy(documentSearchUnits.sequence).limit(12) : [];
  return { documentId: book.id, title: book.title || book.fileName || "行政法考點演習書（二版）｜彭狸", rows };
}

const teacherContext = `
【專屬教材】彭狸，《行政法考點（考前衝刺）演習書》，2026年二版。
【教材結構】行政法理論基礎與行政組織法、行政處分、行政契約與行政命令、行政罰法、行政執行法、訴願法與行政訴訟法、國家賠償法與損失補償、新進實務見解整理。
【目前已核對試學範圍】
1. 公私法區分：法律條文性質可由新主體說判斷；事件性質需先看原告主張的請求權基礎。釋字第758號指出，依民法第767條請求返還土地，原則上屬私法爭議，即使被告以公法關係抗辯亦不改變。老師提醒：這是基本功但不是考試熱區，先熟悉新主體說與釋字第758號。
2. 法律保留原則：以釋字第443號的層級化法律保留為核心；依人身自由、其他自由權利、技術細節與重大給付行政事項調整規範密度。地方自治事項另注意自治條例與釋字第806號。
3. 明確性原則：概念容許解釋不當然違反明確性；應從受規範者可理解、可預見及可經司法審查等方向說明。
`;

export async function POST(request: Request) {
  try {
    const auth = await requireMember(request);
    if ("error" in auth) return auth.error;
    const body = await request.json() as { messages?: InputMessage[]; selectedText?: string; requestKey?: string; mode?: "scholar-assist" | "plain-explain"; allowAiFallback?: boolean };
    if (body.mode === "scholar-assist" && !(await getAiPlan(auth.db)).scholarAssistEnabled) {
      return Response.json({ error: "學霸幫我回答目前未開放。", code: "SCHOLAR_ASSIST_DISABLED" }, { status: 403 });
    }
    const gate = await prepareAiUse(request, "pengli");
    if (gate instanceof Response) return gate;
    if (!await getOpenAIKey()) return Response.json({ error: "彭狸 AI 教練尚未設定模型。" }, { status: 503 });

    const selectedText = String(body.selectedText ?? "").trim().slice(0, 1200);
    const rawMessages = body.mode === "plain-explain" ? [{ role: "student", text: selectedText }] : (Array.isArray(body.messages) ? body.messages : []).slice(-12);
    const messages = rawMessages.map((message) => ({
      role: message.role === "coach" ? "assistant" : "user",
      content: String(message.text ?? "").slice(0, 4000),
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
        max_output_tokens: 650,
      }) }) as Record<string, unknown>;
      const scholarDraft = plainText(outputText(payload));
      if (!scholarDraft) return Response.json({ error: "目前無法產生學生代答，請再按一次。" }, { status: 502 });
      return Response.json({ scholarDraft, source: "目前對話上下文" });
    }

    const searchText = rawMessages.slice(-2).map((message) => String(message.text ?? "")).join(" ");
    const evidence = await pengliEvidence(searchText);
    if (!evidence.documentId) return Response.json({ error: "尚未在中央教材庫找到彭狸老師《行政法考點演習書（二版）》（書號 59ML170502），請管理員確認教材檔案仍存在。" }, { status: 409 });
    const plainAiFallback = body.mode === "plain-explain" && body.allowAiFallback === true;
    if (!evidence.rows.length && !plainAiFallback) return Response.json({
      error: body.mode === "plain-explain"
        ? "這段文字尚未命中彭狸老師教材。是否改由 AI 依臺灣行政法一般知識試著白話解釋？"
        : "已找到彭狸老師的書，但本題尚未命中頁面索引。請換成更明確的考點名稱後再試。",
      code: body.mode === "plain-explain" ? "PENGLI_EVIDENCE_NOT_FOUND" : "PENGLI_COACH_EVIDENCE_NOT_FOUND",
      canAiFallback: body.mode === "plain-explain",
    }, { status: 409 });

    const evidenceText = evidence.rows.map((row, index) => {
      const page = row.pageStart ? `本書第 ${row.pageStart}${row.pageEnd && row.pageEnd !== row.pageStart ? `–${row.pageEnd}` : ""} 頁` : "本書頁碼待索引補正";
      return `【教材片段 ${index + 1}｜${page}｜${row.hierarchyPath || row.title || "考點"}】\n${row.text.slice(0, 1800)}`;
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
        max_output_tokens: 1200,
      };
      let payload: Record<string, unknown> = {};
      let parsed: PengliPlainExplanation | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify(requestBody) }) as Record<string, unknown>;
        parsed = parsePengliPlainExplanation(outputText(payload));
      }
      if (!parsed) return Response.json({ error: "AI 回傳格式不完整，請再試一次。" }, { status: 502 });
      const access = await finishAiCoachRound(gate, { action: "pengli_plain_explain_5_rounds", description: "彭狸教材白話解釋，每5次扣1次", requestKey: String(body.requestKey ?? crypto.randomUUID()) });
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

    const startedAt = Date.now();
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是「彭狸 AI 教練」，是依彭狸老師教材建立的 AI 分身，不是真人老師。只能用本次提供的彭狸老師《行政法考點演習書（二版）》片段引導學生，不得混用其他司律老師教材，也不得用一般知識補足教材未記載的內容。回答精簡、口語，一次只教一個判斷步驟；先針對學生剛才的回答給回饋，再問一個問題引導下一步，不要一次傾倒完整擬答。正文中不要插入任何來源或頁碼。請只選擇本次回答實際使用、最直接支持答案的一個教材頁碼，並在整則回答最後一行僅標示一次「依據：行政法考點演習書（二版）第X頁」。不得列出檢索過但未實際使用的其他頁碼；教材片段沒有頁碼時標示「頁碼待索引補正」，絕不可顯示 X–X 或虛構頁碼。禁止使用 Markdown 符號（包括 **、#、>），不要生成 AI 學霸內容。\n${teacherContext}\n\n【本輪彭狸老師專屬教材】\n${evidenceText}`,
      input: messages,
      max_output_tokens: 1200,
    }) }) as Record<string, unknown>;
    const rawReply = plainText(outputText(payload).replace(/【教練回應】/gu, "").replace(/【學霸追問】[\s\S]*$/u, ""));
    const citedMatch = [...rawReply.matchAll(/(?:本書)?第\s*(\d+)(?:\s*[–—-]\s*(\d+))?\s*頁/gu)].at(-1);
    const reply = rawReply.replace(/\s*[（(]?\s*依據[：:][^\n]*第\s*\d+(?:\s*[–—-]\s*\d+)?\s*頁\s*[）)]?\s*$/u, "").trim();
    if (!reply) return Response.json({ error: "彭狸 AI 教練沒有產生可顯示的回答。" }, { status: 502 });
    const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } : {};
    const inputTokens = Number(rawUsage.input_tokens ?? 0);
    const cachedTokens = Number(rawUsage.input_tokens_details?.cached_tokens ?? 0);
    const outputTokens = Number(rawUsage.output_tokens ?? 0);
    const costMicros = estimateCostUsdMicros(model, { inputTokens, cachedTokens, outputTokens });
    try { const db = await getDb(); await db.insert(usageLogs).values({ model, source: "彭狸老師專區｜AI 分身教練", inputTokens, cachedTokens, outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: costMicros }); } catch { /* 回答不因成本紀錄失敗而中斷 */ }
    const access = await finishAiCoachRound(gate, { action: "pengli_coach_5_rounds", description: "彭狸 AI 分身陪練，每 5 輪扣 1 次", requestKey: String(body.requestKey ?? crypto.randomUUID()) });
    const fallbackPage = evidence.rows.find((row) => row.pageStart)?.pageStart;
    const citedPage = citedMatch ? `${citedMatch[1]}${citedMatch[2] ? `–${citedMatch[2]}` : ""}` : fallbackPage ? String(fallbackPage) : "頁碼待索引補正";
    const source = citedPage === "頁碼待索引補正" ? `行政法考點演習書（二版）》${citedPage}` : `行政法考點演習書（二版）》第${citedPage}頁`;
    return Response.json({ reply, source, access, usage: { model, inputTokens, cachedTokens, outputTokens, durationMs: Date.now() - startedAt, estimatedCostUsd: costMicros / 1_000_000 } });
  } catch (error) {
    console.error("Pengli coach request failed", error);
    return Response.json({ error: "教材搜尋暫時沒有完成，請再按一次；若仍無法回答，請換成較精簡的考點名稱。" }, { status: 500 });
  }
}
