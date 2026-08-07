import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { examCoachMessages, examQuestions, learningResources, legalArticles, legalDocuments, resourceSegments, usageLogs } from "../../../db/schema";
import { getAnthropicChatModel, getAnthropicKey, getDeepSeekKey, getDeepSeekModel, getOpenAIModel, openAIJson } from "../../../lib/openai";

type CoachMessage = { role: "mentor" | "student"; text: string };
type CoachAction = "start" | "coach" | "variation_basic" | "variation_advanced";
type CoachProvider = "luna" | "sonnet" | "deepseek";
type CoachProgress = {
  stage: number;
  current: string;
  items: Array<{ label: string; status: "done" | "current" | "pending" }>;
  readyForEssay: boolean;
};

const coachStageLabels = ["拆解甲的行為", "處理第一個行為", "處理第二個行為", "處理結果與因果關係", "三段論法練習", "正式作答"];

function coachProgress(studentCount: number): CoachProgress {
  const stage = Math.min(Math.max(studentCount, 0), coachStageLabels.length - 1);
  return {
    stage,
    current: coachStageLabels[stage],
    items: coachStageLabels.map((label, index) => ({ label, status: index < stage ? "done" : index === stage ? "current" : "pending" })),
    readyForEssay: stage >= 5,
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; selectedAnswer?: string; studentAnswer?: string; action?: CoachAction; messages?: CoachMessage[]; modelMode?: string; teachingLevel?: string };
    const questionId = Number(body.questionId);
    const action: CoachAction = ["start", "variation_basic", "variation_advanced"].includes(String(body.action)) ? body.action as CoachAction : "coach";
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

    const history = (Array.isArray(body.messages) ? body.messages : []).slice(-8).map((message) => `${message.role === "student" ? "學生" : "教練"}：${String(message.text).slice(0, 800)}`).join("\n");
    const resourceContext = resources.map((item) => `ID ${item.segmentId}｜${item.resourceType}｜${item.resourceTitle}｜${item.lessonLabel} ${item.segmentTitle}｜${item.summary || item.text.slice(0, 220)}`).join("\n");
    const lawContext = laws.map((item) => `ID ${item.id}｜${item.title} ${item.articleNo}｜${item.content.slice(0, 360)}`).join("\n");
    const actionInstruction = action === "start"
      ? "這是第一次引導。先肯定學生開始練習，接著只問一個問題：先不要急著找法條，請學生拆出題目中甲分別做了哪些可能涉及刑責的行為。不要直接公布答案。"
      : action === "variation_basic"
        ? "依原真題改一個關鍵事實，出一題基礎模擬變化題；明確標示這是模擬變化題，不得冒充歷屆真題，最後只問一個問題。"
        : action === "variation_advanced"
          ? "依原真題改變程序階段、當事人主張或關鍵要件，出一題進階模擬變化題；明確標示這是模擬變化題，不得冒充歷屆真題，最後只問一個問題。"
          : "根據學生剛才的回答診斷理解缺口。先肯定已掌握部分，再只問一個學生可直接回答的小問題；完整處理目前階段後，必須明確銜接下一階段，不能在一個爭點結束。";
    const studentCount = Array.isArray(body.messages) ? body.messages.filter((message) => message.role === "student").length : 0;
    const progress = coachProgress(studentCount);
    const stage = progress.current;
    const teachingTone = body.teachingLevel === "beginner" ? "用法律小白聽得懂的語句，少用術語並逐步解釋。" : body.teachingLevel === "advanced" || body.teachingLevel === "super" ? "可追問學說、實務分歧與精準涵攝，但每次仍只問一個問題。" : "維持司律考生可理解的自然教練語氣。";
    const instructions = `你是台灣司律考試的申論 AI 導師。只使用提供的真題、老師資料、法條與教材候選，不得捏造來源。${teachingTone}\n目前階段：${stage}\n${actionInstruction}\n每次回覆 120 至 260 字，像首頁的自然對話一樣：先回應學生剛才說的內容，再提出一個學生可以直接回答的小問題。不要把回答寫成表格、講義或完整擬答。你必須依序引導：先拆解題目中甲的行為，再逐一處理每個行為的爭點、規範、涵攝、結論，最後才進入正式作答。學生答對目前階段後，必須在同一則回覆明確說明「這一段完成了」，並自然銜接下一段，例如「B 的部分完成了，接下來我們看 C」；不得在只列出一個爭點後結束。學生答錯時，指出錯誤方向並留在目前階段追問。每次只問一個主要問題。不得使用 Markdown 星號、井號或反引號。`;
    const input = `真題：${question.year} ${question.subject} 第 ${question.questionNumber} 題\n${fullQuestion}\n老師擬答：${question.teacherAnswer || "尚無"}\n老師補充：${question.teacherNotes || "尚無"}\n學生申論草稿：${String(body.studentAnswer || "未提供").slice(0, 5000)}\n對話：\n${history || "尚未開始"}\n\n教材候選：\n${resourceContext || "無"}\n\n法條候選：\n${lawContext || "無"}`;
    const runs = await Promise.all(providersFor(String(body.modelMode ?? "luna")).map(async (provider) => {
      try { return await runProvider(provider, instructions, input); }
      catch (error) { return { provider, label: providerLabel(provider), model: provider, text: `【${providerLabel(provider)}暫時無法回應】`, inputTokens: 0, outputTokens: 0, error: error instanceof Error ? error.message : "模型暫時無法回應" }; }
    }));
    const primary = runs.find((run) => !run.error && run.text.trim()) ?? runs[0];
    if (!primary?.text?.trim()) return Response.json({ error: "AI 未產生可顯示內容" }, { status: 502 });
    const key = userKey(request);
    const latestStudent = Array.isArray(body.messages) ? [...body.messages].reverse().find((message) => message.role === "student" && message.text.trim()) : null;
    if (latestStudent) await db.insert(examCoachMessages).values({ userKey: key, questionId, role: "student", text: latestStudent.text.trim() });
    if (primary.text?.trim()) await db.insert(examCoachMessages).values({ userKey: key, questionId, role: "mentor", text: primary.text.trim() });
    for (const run of runs) await db.insert(usageLogs).values({ model: run.model, source: "真題教練", inputTokens: run.inputTokens, cachedTokens: 0, outputTokens: run.outputTokens, fileSearchCalls: 0, estimatedCostUsdMicros: 0 });
    const recommendedResources = resources.slice(0, 4).map((item) => ({ type: item.resourceType, title: item.resourceTitle, location: item.resourceType === "course" && item.startSeconds != null ? `${item.segmentTitle} · ${Math.floor(item.startSeconds / 60)}:${String(item.startSeconds % 60).padStart(2, "0")}` : [item.lessonLabel, item.pageStart ? `第 ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `–${item.pageEnd}` : ""} 頁` : ""].filter(Boolean).join(" · "), url: item.sourceUrl, startSeconds: item.startSeconds }));
    const recommendedLaws = laws.slice(0, 4).map((item) => ({ type: "law", title: `${item.title} ${item.articleNo}`, location: item.content.slice(0, 140), url: item.sourceUrl, startSeconds: null }));
    return Response.json({ reply: primary.text, diagnosedGap: "", keyIssue: stage, progress, recommendations: [...recommendedLaws, ...recommendedResources], comparisons: runs.map((run) => ({ label: run.label, model: run.model, text: run.text, inputTokens: run.inputTokens, outputTokens: run.outputTokens, estimatedCostUsd: 0 })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 280) : "真題教練暫時無法回應" }, { status: 500 });
  }
}
