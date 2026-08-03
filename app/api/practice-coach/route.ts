import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { examQuestions, learningResources, legalArticles, legalDocuments, resourceSegments, usageLogs } from "../../../db/schema";
import { openAIJson } from "../../../lib/openai";

type CoachMessage = { role: "mentor" | "student"; text: string };
type CoachAction = "coach" | "variation_basic" | "variation_advanced";

function outputText(payload: Record<string, unknown>) {
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
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

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; selectedAnswer?: string; studentAnswer?: string; action?: CoachAction; messages?: CoachMessage[] };
    const questionId = Number(body.questionId);
    const action: CoachAction = ["variation_basic", "variation_advanced"].includes(String(body.action)) ? body.action as CoachAction : "coach";
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
    const actionInstruction = action === "variation_basic"
      ? "依原真題改一個關鍵事實，出一題基礎模擬變化題；明確標示這是模擬變化題，不得冒充歷屆真題，最後只問一個問題。"
      : action === "variation_advanced"
        ? "依原真題改變程序階段、當事人主張或關鍵要件，出一題進階模擬變化題；明確標示這是模擬變化題，不得冒充歷屆真題，最後只問一個問題。"
        : "根據學生剛才的回答診斷理解缺口。先肯定已掌握部分，再只問一個學生可直接回答的小問題；不要立刻傾倒完整解析。";
    const model = action === "variation_advanced" ? "gpt-5.6-terra" : "gpt-5.6-luna";
    const payload = await openAIJson("/responses", { method: "POST", body: JSON.stringify({
      model,
      instructions: `你是台灣司律考試真題教練。只使用提供的真題、老師資料、法條與教材候選，不得捏造來源。${actionInstruction} 回覆 120 至 260 字。diagnosed_gap 要具體指出是法條記憶、程序階段、爭點辨認、要件理解、選項比較或涵攝哪一種缺口。key_issue 用一句話寫出本題核心法律問題。只推薦與本題直接相關的候選 ID；沒有合適資料就回傳空陣列。不得使用 Markdown 星號。`,
      input: `真題：${question.year} ${question.subject} 第 ${question.questionNumber} 題\n${fullQuestion}\n正確答案：${question.correctAnswer || "申論題"}\n老師擬答：${question.teacherAnswer || "尚無"}\n老師補充：${question.teacherNotes || "尚無"}\n學生選項：${body.selectedAnswer || "未提供"}\n學生申論草稿：${String(body.studentAnswer || "未提供").slice(0, 5000)}\n對話：\n${history || "尚未開始"}\n\n教材候選：\n${resourceContext || "無"}\n\n法條候選：\n${lawContext || "無"}`,
      text: { format: { type: "json_schema", name: "practice_coach", strict: true, schema: { type: "object", additionalProperties: false, properties: { reply: { type: "string" }, diagnosed_gap: { type: "string" }, key_issue: { type: "string" }, recommended_resource_ids: { type: "array", items: { type: "integer" } }, recommended_law_ids: { type: "array", items: { type: "integer" } } }, required: ["reply", "diagnosed_gap", "key_issue", "recommended_resource_ids", "recommended_law_ids"] } } },
    }) });
    const parsed = JSON.parse(outputText(payload)) as { reply: string; diagnosed_gap: string; key_issue: string; recommended_resource_ids: number[]; recommended_law_ids: number[] };
    const recommendedResources = resources.filter((item) => parsed.recommended_resource_ids.includes(item.segmentId)).slice(0, 4).map((item) => ({ type: item.resourceType, title: item.resourceTitle, location: item.resourceType === "course" && item.startSeconds != null ? `${item.segmentTitle} · ${Math.floor(item.startSeconds / 60)}:${String(item.startSeconds % 60).padStart(2, "0")}` : [item.lessonLabel, item.pageStart ? `第 ${item.pageStart}${item.pageEnd && item.pageEnd !== item.pageStart ? `–${item.pageEnd}` : ""} 頁` : ""].filter(Boolean).join(" · "), url: item.sourceUrl, startSeconds: item.startSeconds }));
    const recommendedLaws = laws.filter((item) => parsed.recommended_law_ids.includes(item.id)).slice(0, 4).map((item) => ({ type: "law", title: `${item.title} ${item.articleNo}`, location: item.content.slice(0, 140), url: item.sourceUrl, startSeconds: null }));
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
    await db.insert(usageLogs).values({ model: String(payload.model ?? model), source: "真題教練", inputTokens: usage?.input_tokens ?? 0, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, fileSearchCalls: 0, estimatedCostUsdMicros: 0 });
    return Response.json({ reply: parsed.reply, diagnosedGap: parsed.diagnosed_gap, keyIssue: parsed.key_issue, recommendations: [...recommendedLaws, ...recommendedResources] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 280) : "真題教練暫時無法回應" }, { status: 500 });
  }
}
