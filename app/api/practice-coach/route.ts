import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { examCoachMessages, examQuestions, learningResources, legalArticles, legalDocuments, resourceSegments, usageLogs } from "../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIModel, openAIJson } from "../../../lib/openai";
import { compactConversation, relevantSections } from "../../../lib/input-budget";

type CoachMessage = { role: "mentor" | "student" | "scholar"; text: string };
type CoachAction = "start" | "coach" | "variation_basic" | "variation_advanced" | "subquestion_summary" | "end_summary";
type CoachProvider = "luna" | "sonnet" | "deepseek";
type CoachProgress = {
  stage: number;
  current: string;
  items: Array<{ label: string; status: "done" | "current" | "pending" }>;
  readyForEssay: boolean;
};
type VariationQuestion = {
  level: "basic" | "advanced";
  stem: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  changedFact: string;
};

function coachStageLabelsFor(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("刑法") && !normalized.includes("刑事訴訟")) {
    return ["辨識人物與行為", "形成爭點", "理解法律判準", "逐段涵攝", "確認結論與理由", "微型變化題驗收", "學生選擇下一步"];
  }
  if (normalized.includes("公司") || normalized.includes("商事")) {
    return ["辨認當事人與法律關係", "形成爭點", "理解法律判準", "逐段涵攝", "確認結論與理由", "微型變化題驗收", "學生選擇下一步"];
  }
  return ["整理題目事實與法律關係", "形成爭點", "理解法律判準", "逐段涵攝", "確認結論與理由", "微型變化題驗收", "學生選擇下一步"];
}

function coachProgress(stageIndex: number, subject: string): CoachProgress {
  const coachStageLabels = coachStageLabelsFor(subject);
  // 學習階段只由「本輪是否答中關鍵判準」推進，不能用對話輪數代替理解程度。
  const stage = Math.min(Math.max(Math.floor(stageIndex), 0), coachStageLabels.length - 1);
  return {
    stage,
    current: coachStageLabels[stage],
    items: coachStageLabels.map((label, index) => ({ label, status: index < stage ? "done" : index === stage ? "current" : "pending" })),
    readyForEssay: stage >= coachStageLabels.length - 1,
  };
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
}

function providersFor(mode: string): CoachProvider[] {
  const allowed = ["luna", "sonnet", "deepseek"];
  if (mode.startsWith("compare-")) return mode.slice(8).split("-").filter((item): item is CoachProvider => allowed.includes(item));
  return allowed.includes(mode) ? [mode as CoachProvider] : ["luna"];
}

function providerLabel(provider: CoachProvider) { return provider === "luna" ? "Luna" : provider === "sonnet" ? "Claude Sonnet" : "DeepSeek V4-Pro"; }

function parseCoachReply(text: string) {
  const match = text.match(/^\s*【關聯判定：(related|drift|off_topic)】\s*/i);
  const stageMatch = text.match(/【階段判定：(pass|retry|reveal)】/i);
  return {
    relevance: (match?.[1]?.toLowerCase() ?? "related") as "related" | "drift" | "off_topic",
    stagePassed: stageMatch?.[1]?.toLowerCase() === "pass",
    answerRevealed: stageMatch?.[1]?.toLowerCase() === "reveal",
    text: text
      .replace(/^\s*【關聯判定：(related|drift|off_topic)】\s*/i, "")
      .replace(/【階段判定：(pass|retry|reveal)】\s*/i, "")
      .trim(),
  };
}

function parseVariationQuestion(text: string, level: "basic" | "advanced"): VariationQuestion | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<VariationQuestion>;
    const options = parsed.options as Record<string, unknown> | undefined;
    const correctAnswer = String(parsed.correctAnswer ?? "").toUpperCase();
    if (!parsed.stem || !options || !["A", "B", "C", "D"].every((key) => typeof options[key] === "string" && String(options[key]).trim()) || !["A", "B", "C", "D"].includes(correctAnswer)) return null;
    return {
      level,
      stem: String(parsed.stem).trim(),
      options: { A: String(options.A).trim(), B: String(options.B).trim(), C: String(options.C).trim(), D: String(options.D).trim() },
      correctAnswer: correctAnswer as "A" | "B" | "C" | "D",
      explanation: String(parsed.explanation ?? "請依原題判準重新檢驗變更後的關鍵事實。").trim(),
      changedFact: String(parsed.changedFact ?? "已變更一項關鍵事實").trim(),
    };
  } catch {
    return null;
  }
}

function anthropicText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown[] }).content;
  return Array.isArray(content) ? content.map((item) => item && typeof item === "object" ? String((item as { text?: unknown }).text ?? "") : "").join(" ").trim() : "";
}

async function runProvider(provider: CoachProvider, instructions: string, input: string) {
  if (provider === "sonnet") {
    const key = await getAnthropicKey();
    if (!key) throw new Error("Claude Sonnet API Key 尚未設定");
    const model = await getAnthropicChatModel("claude-sonnet-5");
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4000, system: instructions, messages: [{ role: "user", content: input }] }) });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error("Claude Sonnet 暫時無法回應");
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return { provider, label: providerLabel(provider), model, text: anthropicText(payload), inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0) };
  }
  if (provider === "deepseek") {
    const key = await getDeepSeekKey();
    if (!key) throw new Error("DeepSeek API Key 尚未設定");
    const model = await getDeepSeekModel("deepseek-v4-pro");
    const response = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: instructions }, { role: "user", content: input }], max_tokens: 4000 }) });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    if (!response.ok) throw new Error("DeepSeek V4-Pro 暫時無法回應");
    return { provider, label: providerLabel(provider), model: payload.model || model, text: payload.choices?.[0]?.message?.content?.trim() || "", inputTokens: Number(payload.usage?.prompt_tokens ?? 0), outputTokens: Number(payload.usage?.completion_tokens ?? 0) };
  }
  const model = await getOpenAIModel("gpt-5.6-luna");
  const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({ model, instructions, input }) });
  const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return { provider, label: providerLabel(provider), model, text: outputText(payload), inputTokens: Number(usage?.input_tokens ?? 0), outputTokens: Number(usage?.output_tokens ?? 0) };
}

const subjectLawMap: Record<string, string[]> = {
  刑法: ["中華民國刑法"],
  刑事訴訟法: ["刑事訴訟法"],
  民法: ["民法"],
  民事訴訟法: ["民事訴訟法", "強制執行法"],
  憲法: ["中華民國憲法"],
  行政法: ["行政程序法", "行政訴訟法"],
  商事法: ["公司法", "證券交易法", "保險法", "票據法"],
};

function questionText(question: { stem: string; optionsJson: string | null }) {
  let options = "";
  try {
    const parsed = question.optionsJson ? JSON.parse(question.optionsJson) as Record<string, string> : {};
    options = Object.entries(parsed).map(([key, value]) => `${key}. ${value}`).join("\n");
  } catch { /* keep the stem even when legacy options are malformed */ }
  return `${question.stem}\n${options}`.trim();
}

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function canUseSimulatedStudent(request: Request) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() === "iamflashon@gmail.com";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; selectedAnswer?: string; studentAnswer?: string; action?: CoachAction; messages?: CoachMessage[]; modelMode?: string; teachingLevel?: string; dialogueMode?: "answer_reason" | "discussion"; roundLimit?: number; offTopicCount?: number; currentStage?: number; currentStageRetryCount?: number };
    const questionId = Number(body.questionId);
    const action: CoachAction = ["start", "variation_basic", "variation_advanced", "subquestion_summary", "end_summary"].includes(String(body.action)) ? body.action as CoachAction : "coach";
    if (!Number.isInteger(questionId)) return Response.json({ error: "缺少真題資料" }, { status: 400 });
    const db = await getDb();
    const [question] = await db.select().from(examQuestions).where(and(eq(examQuestions.id, questionId), eq(examQuestions.status, "published"))).limit(1);
    if (!question) return Response.json({ error: "找不到這道真題" }, { status: 404 });

    const resources = await db.select({
      segmentId: resourceSegments.id,
      resourceType: learningResources.resourceType,
      resourceTitle: learningResources.title,
      creator: learningResources.creator,
      sourceUrl: learningResources.sourceUrl,
      segmentTitle: resourceSegments.title,
      lessonLabel: resourceSegments.lessonLabel,
      pageStart: resourceSegments.pageStart,
      pageEnd: resourceSegments.pageEnd,
      startSeconds: resourceSegments.startSeconds,
      endSeconds: resourceSegments.endSeconds,
      summary: resourceSegments.summary,
      text: resourceSegments.text,
      importance: resourceSegments.importance,
    }).from(resourceSegments).innerJoin(learningResources, eq(resourceSegments.resourceId, learningResources.id)).where(and(eq(learningResources.status, "active"), or(eq(learningResources.subject, question.subject), eq(learningResources.subject, "綜合")))).orderBy(desc(resourceSegments.recommended), desc(resourceSegments.importance)).limit(18);

    const fullQuestion = questionText(question);
    const mentionedLaws = Array.from(new Set(fullQuestion.match(/[\u4e00-\u9fff]{2,16}(?:法|條例)/g) ?? []));
    const lawNames = mentionedLaws.length ? mentionedLaws : (subjectLawMap[question.subject] ?? []);
    const lawDocs = lawNames.length ? await db.select().from(legalDocuments).where(and(eq(legalDocuments.status, "active"), inArray(legalDocuments.title, lawNames))).limit(12) : [];
    const articleNumbers = Array.from(new Set(fullQuestion.match(/第\s*\d+(?:-\d+)?\s*條(?:之\s*\d+)?/g)?.map((item) => item.replace(/\s+/g, "")) ?? []));
    const lawRows = lawDocs.length ? await db.select({ id: legalArticles.id, documentId: legalArticles.documentId, articleNo: legalArticles.articleNo, content: legalArticles.content }).from(legalArticles).where(inArray(legalArticles.documentId, lawDocs.map((item) => item.id))).limit(120) : [];
    const laws = lawRows.filter((article) => !articleNumbers.length || articleNumbers.some((number) => article.articleNo.replace(/\s+/g, "").includes(number))).slice(0, 16).map((article) => {
      const doc = lawDocs.find((item) => item.id === article.documentId)!;
      return { id: article.id, title: doc.title, articleNo: article.articleNo, content: article.content, sourceUrl: doc.sourceUrl };
    });

    const simulationAllowed = canUseSimulatedStudent(request);
    const acceptedMessages = compactConversation((Array.isArray(body.messages) ? body.messages : [])
      .filter((message) => message.role !== "scholar" || simulationAllowed), 6, 1000);
    const history = acceptedMessages.map((message) => `${message.role === "student" ? "學生" : message.role === "scholar" ? "AI模擬學生" : "AI導師"}：${String(message.text).slice(0, 600)}`).join("\n");
    const resourceContext = resources.map((item) => `ID ${item.segmentId}｜${item.resourceType}｜${item.resourceTitle}｜${item.lessonLabel} ${item.segmentTitle}｜${item.summary || item.text.slice(0, 220)}`).join("\n");
    const lawContext = laws.map((item) => `ID ${item.id}｜${item.title} ${item.articleNo}｜${item.content.slice(0, 360)}`).join("\n");
    const criminalSubject = question.subject.includes("刑法") && !question.subject.includes("刑事訴訟");
    const companySubject = question.subject.includes("公司") || question.subject.includes("商事");
    const isMcq = question.examType === "mcq";
    const subjectFrame = isMcq
      ? `本題是一試選擇題。學生已選「${String(body.selectedAnswer ?? "尚未選擇").toUpperCase()}」，正確答案是「${String(question.correctAnswer ?? "待核對").toUpperCase()}」。${question.explanation?.trim() ? `題庫解析：${question.explanation.trim()}` : "題庫未提供完整解析，必須依題目、法條與教材候選說明。"}`
      : criminalSubject
      ? "本題是刑法申論，才可以使用甲的行為、犯罪構成、故意、因果關係等刑法語彙。"
      : companySubject
        ? "本題是公司法／商事法申論，不得把題目改寫成刑法案例，也不要使用犯罪行為、犯罪故意或因果關係作為預設框架；應聚焦公司機關、股東／董事身分、法律關係、權利義務、決議效力、規範與涵攝。"
        : `本題科目是${question.subject}，必須依該科目的法律關係與規範進行，不得套用刑法的犯罪行為框架。`;
    const studentCount = acceptedMessages.filter((message) => message.role === "student" || (simulationAllowed && message.role === "scholar")).length;
    const roundLimit = Number(body.roundLimit) === 10 ? 10 : 8;
    const priorOffTopicCount = Math.min(2, Math.max(0, Number(body.offTopicCount ?? 0)));
    const isVariation = action === "variation_basic" || action === "variation_advanced";
    const roundReached = action !== "start" && !isVariation && studentCount >= roundLimit;
    const mcqReasonTurns = isMcq ? Math.max(0, studentCount - 1) : 0;
    const answerIsCorrect = isMcq && String(body.selectedAnswer ?? "").toUpperCase() === String(question.correctAnswer ?? "").toUpperCase();
    const answerConsistencyInstruction = isMcq
      ? `答案判定是系統資料，不得自行改變：學生選 ${String(body.selectedAnswer ?? "").toUpperCase()}，正確答案是 ${String(question.correctAnswer ?? "").toUpperCase()}，所以學生${answerIsCorrect ? "答對" : "答錯"}。每一句都必須與此一致，嚴禁出現前後矛盾的答案判定。`
      : "";
    const actionInstruction = body.dialogueMode === "complete_confirm" && isMcq
      ? "學生已明確表示理解並要求完成本題。請自然收尾：先肯定他完成釐清，再整理兩個最值得記住的判斷，最後寫『這題先完成』。不得再提問、不得擴張新爭點。"
      : body.dialogueMode === "discussion" && isMcq
      ? "學生仍在討論本題。直接回答他現在問的白話解釋、選項比較、學說或例外；不得反問、不得擅自延伸到本題以外，也不得寫『本題完成』或任何結束標記。回答後讓學生自行決定是否繼續。"
      : roundReached
      ? `學生已完成本次第 ${roundLimit} 輪。直接整理本次已掌握重點、尚待加強處與建議下一步，明示本次對話已結束；不得再提問。`
      : action === "start"
      ? criminalSubject
        ? "這是第一次引導。先肯定學生開始練習，接著只問一個問題：先不要急著找法條，請學生拆出題目中甲分別做了哪些可能涉及刑責的行為。不要直接公布答案。"
        : companySubject
          ? "這是第一次引導。先肯定學生開始練習，接著只問一個問題：請學生先整理題目中的當事人、公司機關、法律關係與最可能的爭點，不要先寫完整答案。"
          : "這是第一次引導。先肯定學生開始練習，接著只問一個問題：請學生先整理題目事實中的當事人、法律關係與最可能爭點，不要直接公布完整答案。"
      : action === "variation_basic"
        ? "依原真題只改一個關鍵事實，出一題基礎模擬單選題。必須有完整題幹與 A、B、C、D 四個彼此可區辨的選項，且只有一個正確答案。不得冒充歷屆真題。"
        : action === "variation_advanced"
          ? "依原真題改變一項程序階段、當事人主張或關鍵要件，出一題進階模擬單選題。必須有完整題幹與 A、B、C、D 四個彼此可區辨的選項，且只有一個正確答案。不得冒充歷屆真題。"
          : action === "subquestion_summary"
            ? "學生主動要求完成本單題。請批改學生剛才親自整理的小結；不要重述整份老師擬答，也不要另寫長篇解析。若小結欠缺法律判準、關鍵事實或結論，只指出最重要的一項缺漏，並用一個短問題請學生補上；此時不得宣告通過。若三者齊備，依指定的精簡格式宣告本單題通過。"
            : action === "end_summary"
              ? "學生要求停止回答並結束本段對話。請依目前完整對話直接收束，不得再提出問題。用精簡格式整理：本段結論、已掌握重點、仍須留意一項、下一個尚未處理的行為或爭點；若本題均已處理，明示本題引導結束。"
              : isMcq
                ? `學生已選「${String(body.selectedAnswer ?? "").toUpperCase()}」，並剛說明選擇理由。你正在面對不同程度與反應的學生，必須依下列規則選擇節奏：
0. 先檢查學生是否真的說明所選選項的內容。若只說「符合題意、關鍵文字、法律關係、處理方式、實際情況」等抽象句，卻未指出該選項的決定性法律概念或題目文字，不得視為有效理由，也不得猜測學生已理解。追問必須依本題法科與該選項內容量身形成：直接點出尚未比較的關鍵文字，請學生說明該文字為何使選項成立或不成立。只有選項本身確實涉及請求權時，才可問「誰向誰請求什麼」；刑法、刑訴、公法等題目不得套用民法請求權句型。
1. 答案與理由均正確：直接確認、說明決定性判準，進入「已解析、待學生確認」，不得宣告本題完成。
2. 答案正確但理由薄弱：若這是第一次說理由，只補問一個會影響判斷的短問題；若已補問過一次，直接補齊理由，進入「已解析、待學生確認」。
3. 答錯但已展現可修正思路：第一次只給一個分層提示並問一個短問題；第二次仍未答出時，直接公布答案與判準，進入「已解析、待學生確認」。
4. 學生說不知道、卡住或要求答案：直接用適合其程度的方式示範，不再追問，進入「已解析、待學生確認」。
5. 學生主動提出本題內的學說、例外或反例：先回應，但只有學生明確選擇繼續討論時才能深入；不得自行擴張到其他爭點。
本題目前已收到 ${mcqReasonTurns} 次理由／補充回答。先具體回饋，再明確告知答對或答錯；用一至三句說清楚法律判準與關鍵題目文字。不要列出補強教材、弱點卡或推薦清單。`
                : "根據學生剛才的回答診斷理解缺口。若學生已答到核心、只是把同一結論換句話確認，或同一爭點已連續往返兩次，直接確認結論並標示『本段已完成』，不得再追問；接著用一句話轉入下一個尚未處理的行為或爭點。只有答案仍欠缺一個會改變結論的關鍵要件時，才補問一次短問題。";
    const currentStage = Math.min(Math.max(Math.floor(Number(body.currentStage ?? 0)), 0), coachStageLabelsFor(question.subject).length - 1);
    const currentStageRetryCount = Math.min(Math.max(Math.floor(Number(body.currentStageRetryCount ?? 0)), 0), 3);
    const latestLearnerText = [...acceptedMessages].reverse().find((message) => message.role === "student" || message.role === "scholar")?.text.trim() ?? "";
    const learnerRequestsAnswer = /^(不知道|不會|沒有想法|想不到|請.{0,6}(公布|告訴我|直接講)|可以.{0,6}(公布|告訴我|直接講))/u.test(latestLearnerText);
    const shouldRevealAnswer = action === "coach" && (currentStageRetryCount >= 2 || learnerRequestsAnswer);
    const progress = coachProgress(currentStage, question.subject);
    const stage = progress.current;
    const teachingTone = body.teachingLevel === "beginner" ? "用法律小白聽得懂的語句，少用術語並逐步解釋。" : body.teachingLevel === "advanced" || body.teachingLevel === "super" ? "可追問學說、實務分歧與精準涵攝，但每次仍只問一個問題。" : "維持司律考生可理解的自然教練語氣。";
    const flow = isMcq
      ? "以自然對話帶學生檢查選項：先聽理由，再回饋正誤與判斷關鍵；一次只處理一個最重要的理解缺口，不得改寫成申論六步驟或另列補強資源。"
      : criminalSubject
      ? "先拆解題目中所有行為人的行為，再逐一處理每個行為的爭點、規範、涵攝與結論；完成微型變化題驗收後，只能讓學生選擇下一步，不得自動進入正式作答。"
      : companySubject
        ? "先整理當事人與公司法律關係，再逐一處理公司機關、權利義務、決議效力或其他題目爭點，完成微型變化題驗收後，只能讓學生選擇下一步。"
        : "先整理題目事實與法律關係，再逐一處理各爭點的規範、涵攝與結論；完成微型變化題驗收後，只能讓學生選擇下一步。";
    const responseRule = isVariation
      ? `只輸出可解析的 JSON，不得加 Markdown 或其他文字：{"stem":"完整題幹","options":{"A":"選項A","B":"選項B","C":"選項C","D":"選項D"},"correctAnswer":"A","explanation":"作答後顯示的精簡解析，說明判準與關鍵事實","changedFact":"相較原題改變的唯一關鍵事實"}。選項不得出現「以上皆是／以上皆非」，答案位置不可固定。`
      : roundReached
      ? "回覆限 100 至 180 字，直接總結並結束，不得使用問號。"
      : action === "subquestion_summary"
      ? "回覆限 80 至 160 字。通過時只依序輸出四行：【單題批改：通過】、【答對重點】一項、【一項修正】最多一項、【合格小結】一句。未通過時只輸出：【單題批改：待補充】、【已掌握】一項、【請補上】一項，最後問一個短問題。不得貼出名師擬答，不得逐點羅列學生所有答對內容，不得重複總評。"
      : action === "end_summary"
        ? "回覆限 100 至 180 字，直接總結並結束，不得使用問號、不得要求學生繼續回答，也不得出變化題。"
        : isMcq
          ? body.dialogueMode === "complete_confirm"
            ? "回覆限 80 至 180 字。最後另起一行輸出內部標記【回合判定：complete】；正文只在此模式可以寫『這題先完成』。"
            : body.dialogueMode === "discussion"
              ? "回覆限 70 至 180 字。最後另起一行輸出內部標記【回合判定：follow_up】；不得出現『本題完成』、『這題先完成』或其他結束文字。"
              : "回覆限 55 至 150 字。回覆最後必須另起一行輸出內部標記【回合判定：complete】或【回合判定：follow_up】；complete 只代表解析已足夠、可讓學生確認，不代表本題已完成，因此正文不得寫『本題完成』。只有確有一個決定性缺口且尚未補問過時才能標 follow_up。此標記不會顯示給學生。"
          : "一般回覆限 45 至 110 字。需要追問時只做一句具體回饋，再問一個短問題；已達標或出現重複追問時，改為一句確認、一句本段結論與下一步，不得為維持對話而硬問。不要寫成表格、講義或完整擬答。";
    const relevanceInstruction = isVariation ? "" : `每次回覆開頭必須依序輸出兩個內部標記：【關聯判定：related／drift／off_topic】及【階段判定：pass／retry／reveal】。階段判定只能依學生最新回答是否已包含目前階段所需的關鍵法律判準、題目事實與明確結論；缺少任何會影響答案的要素、答錯、含糊或只重述老師問題，一律標 retry。只有已正面答中本輪核心才標 pass。若系統指示公布答案，必須標 reveal。這兩個標記不會顯示給學生。related 是直接處理本題、相關法條學說、老師解析或合理延伸情境；drift 是仍屬本法科但偏離目前題目；off_topic 僅限閒聊、灌水或轉問完全不同事項，不得只靠關鍵字判斷。drift 應簡短回應後帶回本題；off_topic 不回答無關內容，只提醒回到本題。此前已明顯離題 ${priorOffTopicCount} 次；若此前是 0 次，本輪離題時溫和提醒；若此前是 1 次，本輪離題時明確警告再次離題將提前結束；若本輪判定 off_topic 且此前已達 2 次，直接整理目前成果並明示因三次離題而結束，不得再提問。${shouldRevealAnswer ? "學生已連續無法作答或明確要求答案。本輪不要再追問；請直接公布正確判斷、關鍵法律判準及一項題目事實涵攝，明示『這一輪先由老師示範』，接著自然帶入下一階段，並標記【階段判定：reveal】。" : `學生在目前階段已重試 ${currentStageRetryCount} 次；未答中時換一種更小、更具體的提示繼續引導，不得提前跳到下一階段。`}`;
    const instructions = `你是台灣司律考試的${question.subject}${isMcq ? "一試真題教練" : "申論 AI 導師"}。${subjectFrame}${answerConsistencyInstruction}只使用提供的真題、老師資料、法條與教材候選，不得捏造來源。${teachingTone}\n目前階段：${stage}\n${relevanceInstruction}\n${actionInstruction}\n${responseRule}你必須${flow}${isMcq ? "不要建立核心爭點、需要加強或推薦補強等獨立區塊；所有內容都寫成正在進行的簡短對話。只有學生明確確認理解後才能完成本題。" : "一題有多位行為人或多個爭點時，必須逐項完成，不得以一個答案代表全部通過。答錯時只給分級提示並留在目前階段，不得直接公布完整答案。你必須辨識三種收束訊號：學生已正確說出判準與結論、學生只是換句話重問已回答的疑問、學生表示想停止或要求總結。出現任一訊號時應主動收束，不能繼續用問題延長對話。每個決定性缺口最多補問一次；同一爭點不得連續出現兩次以上內容相同的追問。進入「微型變化題驗收」時只改變一個關鍵事實；學生已能運用判準即宣告驗收完成，不再追加第二題。驗收完成後只能提示「再練一輪、整理解題架構、模考擬答」三種選擇，不得自行產生擬答。"}不得使用 Markdown 星號、井號或反引號。`;
    const answerQuery = `${fullQuestion}\n${String(body.studentAnswer || "")}\n${history}`;
    const teacherAnswer = question.teacherAnswer ? relevantSections(question.teacherAnswer, answerQuery, 7000) : "尚無";
    const teacherNotes = question.teacherNotes ? relevantSections(question.teacherNotes, answerQuery, 2500) : "尚無";
    const input = `真題：${question.year} ${question.subject} 第 ${question.questionNumber} 題\n${fullQuestion}\n老師擬答：${teacherAnswer}\n老師補充：${teacherNotes}\n學生申論草稿：${String(body.studentAnswer || "未提供").slice(0, 5000)}\n對話：\n${history || "尚未開始"}\n\n教材候選：\n${resourceContext || "無"}\n\n法條候選：\n${lawContext || "無"}`;
    // 首頁「練真題／寫申論」的教練固定使用 Luna 單模型；忽略舊的
    // 管理測試偏好，避免比較模式產生多次 API 費用。
    const runs = await Promise.all(providersFor("luna").map(async (provider) => {
      try { return await runProvider(provider, instructions, input); }
      catch (error) { return { provider, label: providerLabel(provider), model: provider, text: `【${providerLabel(provider)}暫時無法回應】`, inputTokens: 0, outputTokens: 0, error: error instanceof Error ? error.message : "模型暫時無法回應" }; }
    }));
    const parsedRuns = runs.map((run) => {
      const completed = /【回合判定：complete】/i.test(run.text);
      const cleaned = run.text.replace(/【回合判定：(complete|follow_up)】\s*/gi, "").trim();
      return { ...run, text: cleaned, completed, ...parseCoachReply(cleaned) };
    });
    const primary = parsedRuns.find((run) => !run.error && run.text.trim()) ?? parsedRuns[0];
    if (!primary?.text?.trim()) return Response.json({ error: "AI 未產生可顯示內容" }, { status: 502 });
    const key = userKey(request);
    // Only text actually entered by the learner is stored as a student answer.
    // Administrator-generated simulation text must never be relabelled as the learner's own words.
    const latestStudent = [...acceptedMessages].reverse().find((message) => message.role === "student" && message.text.trim()) ?? null;
    if (latestStudent) await db.insert(examCoachMessages).values({ userKey: key, questionId, role: "student", text: latestStudent.text.trim() });
    const variation = isVariation && primary?.text
      ? parseVariationQuestion(primary.text, action === "variation_basic" ? "basic" : "advanced")
      : null;
    if (isVariation && !variation) return Response.json({ error: "AI 產生的變化題格式不完整，請再試一次" }, { status: 502 });
    if (primary.text?.trim() && !isVariation) await db.insert(examCoachMessages).values({ userKey: key, questionId, role: "mentor", text: primary.text.trim() });
    for (const run of parsedRuns) await db.insert(usageLogs).values({ model: run.model, source: "真題教練", inputTokens: run.inputTokens, cachedTokens: 0, outputTokens: run.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: 0 });
    const recommendedResources = resources.slice(0, 4).map((item) => ({ type: item.resourceType, title: item.resourceTitle, location: item.resourceType === "course" && item.startSeconds != null ? `${item.segmentTitle} · ${Math.floor(item.startSeconds / 60)}:${String(item.startSeconds % 60).padStart(2, "0")}` : [item.lessonLabel, item.pageStart ? `第 ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `–${item.pageEnd}` : ""} 頁` : ""].filter(Boolean).join(" · "), url: item.sourceUrl, startSeconds: item.startSeconds }));
    const recommendedLaws = laws.slice(0, 4).map((item) => ({ type: "law", title: `${item.title} ${item.articleNo}`, location: item.content.slice(0, 140), url: item.sourceUrl, startSeconds: null }));
    const offTopicCount = Math.min(3, priorOffTopicCount + (primary.relevance === "off_topic" ? 1 : 0));
    const stagePassed = action === "coach" && (primary.stagePassed || primary.answerRevealed || shouldRevealAnswer) && primary.relevance === "related";
    const answerRevealed = action === "coach" && (primary.answerRevealed || shouldRevealAnswer) && primary.relevance === "related";
    const nextProgress = coachProgress(stagePassed ? currentStage + 1 : currentStage, question.subject);
    const nextStageRetryCount = stagePassed ? 0 : Math.min(currentStageRetryCount + 1, 3);
    const ended = action === "end_summary" || offTopicCount >= 3;
    return Response.json({ reply: isVariation ? undefined : primary.text, variation, completed: isMcq ? Boolean(primary.completed) : undefined, relevance: primary.relevance, offTopicCount, ended, answerRevealed, currentStageRetryCount: nextStageRetryCount, diagnosedGap: stagePassed ? (answerRevealed ? "本階段由老師示範答案後繼續，未計為學生自行答對。" : "") : "尚未答中本階段關鍵，AI 導師會換一種方式繼續引導。", keyIssue: nextProgress.current, progress: nextProgress, recommendations: [...recommendedLaws, ...recommendedResources], comparisons: parsedRuns.map((run) => ({ label: run.label, model: run.model, text: run.text, inputTokens: run.inputTokens, outputTokens: run.outputTokens, estimatedCostUsd: 0 })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 280) : "真題教練暫時無法回應" }, { status: 500 });
  }
}
