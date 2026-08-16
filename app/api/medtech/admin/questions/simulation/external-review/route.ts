import { and, desc, eq } from "drizzle-orm";
import { examQuestions, medtechQuestionEvidenceReviews, usageLogs } from "../../../../../../../db/schema";
import { requireMedtechAdmin } from "../../../../../../../lib/member-auth";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../../../../../lib/openai";

type Citation = { title: string; url: string };
type EvidenceReview = {
  questionFound: "yes" | "no" | "unclear";
  answerAssessment: "teacher" | "ai" | "ambiguous" | "insufficient";
  answerReason: string;
  leakageRisk: "none_found" | "possible" | "high_similarity" | "insufficient";
  leakageReason: string;
  searchSummary: string;
  candidateSources: Array<{
    title: string;
    url: string;
    sourceType: "official" | "exam_bank" | "teaching_site" | "forum" | "unknown";
    relationship: "exact_question" | "similar_question" | "answer_or_explanation" | "background" | "unclear";
    excerpt: string;
  }>;
  matchedPhrases: string[];
  limitations: string;
  manualEvidence?: string;
  citations: Citation[];
  searchedAt: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; webSearchCalls: number; estimatedCostUsdMicros: number };
};

function plain(value: string) {
  return String(value ?? "").replace(/<br\s*\/?\s*>/giu, "\n").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function optionsOf(value: string | null) {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, plain(String(item ?? ""))]));
  } catch {
    return {};
  }
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [String((part as { text: string }).text)] : []);
  }).join("").trim();
}

function extractWebCitations(payload: Record<string, unknown>) {
  const citations: Citation[] = [];
  const output = Array.isArray(payload.output) ? payload.output : [];
  const add = (title: unknown, url: unknown) => {
    const normalizedUrl = String(url ?? "").trim();
    if (!/^https?:\/\//iu.test(normalizedUrl)) return;
    citations.push({ title: String(title ?? "外部搜尋來源").trim() || "外部搜尋來源", url: normalizedUrl });
  };
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as { content?: unknown[]; action?: { sources?: unknown[] } };
    const content = Array.isArray(row.content) ? row.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const annotations = Array.isArray((part as { annotations?: unknown[] }).annotations) ? (part as { annotations: unknown[] }).annotations : [];
      for (const annotation of annotations) {
        if (!annotation || typeof annotation !== "object") continue;
        const citation = annotation as { type?: string; title?: unknown; url?: unknown };
        if (citation.type === "url_citation") add(citation.title, citation.url);
      }
    }
    const sources = Array.isArray(row.action?.sources) ? row.action.sources : [];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      add((source as { title?: unknown }).title, (source as { url?: unknown }).url);
    }
  }
  return [...new Map(citations.map((item) => [item.url, item])).values()].slice(0, 12);
}

function parseStored(value: string) {
  try { return JSON.parse(value) as EvidenceReview; } catch { return null; }
}

function urlsFromText(value: string) {
  return [...new Set(value.match(/https?:\/\/[^\s<>()\[\]"']+/giu) ?? [])].slice(0, 12).map((url) => ({
    title: "使用者貼上的外部來源",
    url: url.replace(/[.,;，。；、]+$/u, ""),
  }));
}

export async function GET(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("questionId"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const rows = await auth.db.select().from(medtechQuestionEvidenceReviews)
    .where(eq(medtechQuestionEvidenceReviews.questionId, id))
    .orderBy(desc(medtechQuestionEvidenceReviews.createdAt))
    .limit(1);
  return Response.json({ review: rows[0] ? parseStored(rows[0].resultJson) : null });
}

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; mode?: "web" | "manual"; evidenceText?: string };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const [question] = await auth.db.select().from(examQuestions).where(and(
    eq(examQuestions.id, id),
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
  )).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢選擇題" }, { status: 404 });

  if (body.mode === "manual") {
    const manualEvidence = String(body.evidenceText ?? "").trim().slice(0, 20_000);
    if (manualEvidence.length < 10) return Response.json({ error: "請先貼上至少一段外部搜尋結果或查核備註。" }, { status: 400 });
    const review: EvidenceReview = {
      questionFound: "unclear",
      answerAssessment: "insufficient",
      answerReason: "這是人工貼上的外部資料，系統沒有替你判定老師或 AI 哪個答案正確。",
      leakageRisk: "insufficient",
      leakageReason: "僅保存查核資料，沒有足夠機制直接認定抄襲或外洩。請由老師比對題幹來源、出版時間與授權狀態。",
      searchSummary: "已保存人工貼上的外部搜尋結果；未呼叫 AI，也未啟動付費外部搜尋。",
      candidateSources: [],
      matchedPhrases: [],
      limitations: "人工貼上內容需要老師自行核對；這筆紀錄不代表外部來源已經驗證。",
      manualEvidence,
      citations: urlsFromText(manualEvidence),
      searchedAt: new Date().toISOString(),
      model: "manual",
      usage: { inputTokens: 0, outputTokens: 0, webSearchCalls: 0, estimatedCostUsdMicros: 0 },
    };
    await auth.db.insert(medtechQuestionEvidenceReviews).values({
      questionId: id,
      reviewer: auth.member.email,
      provider: "manual_paste",
      queryText: `題目 ${question.questionNumber}｜人工貼上外部查核資料`,
      resultJson: JSON.stringify(review),
    });
    return Response.json({ review, questionId: id });
  }

  const key = await getOpenAIKey();
  if (!key) return Response.json({ error: "醫檢 AI 模型尚未設定，暫時無法啟動外部查核。" }, { status: 503 });
  const options = optionsOf(question.optionsJson);
  const questionText = plain(question.stem).slice(0, 5000);
  const teacherAnswer = String(question.teacherAnswer || question.correctAnswer || "").trim().toUpperCase();
  const aiAnswer = String(question.simulatedAnswer || "").trim().toUpperCase();
  const queryText = [
    `科目：${question.subject}`,
    `年份：${question.year}`,
    `題號：${question.questionNumber}`,
    `題幹：${questionText}`,
    `選項：${JSON.stringify(options)}`,
    `老師答案：${teacherAnswer || "未設定"}`,
    `AI答案：${aiAnswer || "未設定"}`,
  ].join("\n");
  const model = await getOpenAIModel("gpt-5.6-luna");
  let payload: Record<string, unknown>;
  try {
    payload = await openAIJson("/responses", {
      method: "POST",
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        instructions: "你是醫檢師國考題庫的外部證據查核員。這次必須先使用 web_search，不能只依一般常識回答。請搜尋完整題幹的精確片段、關鍵句與選項，確認公開網路上是否出現相同題目、近似題目、原始考題、公開答案或解析。也要比較老師答案與 AI 答案，但不得因老師或 AI 的身分而先入為主。\n\n重要限制：1. 只有實際搜尋結果支持的內容才能列為證據。2. candidate_sources 的 URL 必須來自本次 web_search 實際引用來源；如果沒有實際來源，請留空。3. 找到相同或高度相似文字，只能標示『疑似外部相同／高度相似，需人工確認』，不得直接宣稱抄襲或外洩成立。4. 沒有足夠來源時，question_found 與 leakage_risk 使用 unclear 或 insufficient。5. 不要把教材內部的老師答案當成外部證據。6. 使用繁體中文，簡潔但要說明判斷依據。",
        input: `${queryText}\n\n請回傳外部查核結果。`,
        text: {
          format: {
            type: "json_schema",
            name: "medtech_external_evidence_review",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                questionFound: { type: "string", enum: ["yes", "no", "unclear"] },
                answerAssessment: { type: "string", enum: ["teacher", "ai", "ambiguous", "insufficient"] },
                answerReason: { type: "string" },
                leakageRisk: { type: "string", enum: ["none_found", "possible", "high_similarity", "insufficient"] },
                leakageReason: { type: "string" },
                searchSummary: { type: "string" },
                candidateSources: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      sourceType: { type: "string", enum: ["official", "exam_bank", "teaching_site", "forum", "unknown"] },
                      relationship: { type: "string", enum: ["exact_question", "similar_question", "answer_or_explanation", "background", "unclear"] },
                      excerpt: { type: "string" },
                    },
                    required: ["title", "url", "sourceType", "relationship", "excerpt"],
                  },
                },
                matchedPhrases: { type: "array", maxItems: 5, items: { type: "string" } },
                limitations: { type: "string" },
              },
              required: ["questionFound", "answerAssessment", "answerReason", "leakageRisk", "leakageReason", "searchSummary", "candidateSources", "matchedPhrases", "limitations"],
            },
          },
        },
        max_output_tokens: 2400,
      }),
    }) as Record<string, unknown>;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "外部查核服務暫時無法使用" }, { status: 502 });
  }

  const citations = extractWebCitations(payload);
  const citedUrls = new Set(citations.map((item) => item.url));
  let parsed: Partial<EvidenceReview> = {};
  try { parsed = JSON.parse(outputText(payload)) as Partial<EvidenceReview>; } catch { /* below uses safe fallbacks */ }
  const candidateSources = (Array.isArray(parsed.candidateSources) ? parsed.candidateSources : [])
    .filter((item): item is NonNullable<EvidenceReview["candidateSources"]>[number] => Boolean(item && typeof item === "object" && citedUrls.has(String((item as { url?: unknown }).url ?? ""))))
    .slice(0, 8)
    .map((item) => ({
      title: String(item.title || "外部搜尋來源").slice(0, 180),
      url: String(item.url).slice(0, 1200),
      sourceType: item.sourceType || "unknown",
      relationship: item.relationship || "unclear",
      excerpt: String(item.excerpt || "").slice(0, 500),
    }));
  const usageObject = payload.usage && typeof payload.usage === "object" ? payload.usage as { input_tokens?: number; output_tokens?: number } : {};
  const rates = model === "gpt-5.6-luna" ? { input: 0.10, output: 0.60 } : model === "gpt-5.6-sol" ? { input: 2.50, output: 15 } : { input: 1, output: 6 };
  const estimatedCostUsdMicros = Math.round(10_000 + (Number(usageObject.input_tokens ?? 0) * rates.input + Number(usageObject.output_tokens ?? 0) * rates.output));
  const review: EvidenceReview = {
    questionFound: parsed.questionFound || "unclear",
    answerAssessment: parsed.answerAssessment || "insufficient",
    answerReason: String(parsed.answerReason || "目前沒有足夠外部證據判斷老師或 AI 答案較正確。").slice(0, 1600),
    leakageRisk: parsed.leakageRisk || "insufficient",
    leakageReason: String(parsed.leakageReason || "目前只能標示搜尋結果，不能直接判定抄襲或外洩。").slice(0, 1600),
    searchSummary: String(parsed.searchSummary || "已啟動外部搜尋，但尚未形成足夠結論。").slice(0, 1600),
    candidateSources,
    matchedPhrases: (Array.isArray(parsed.matchedPhrases) ? parsed.matchedPhrases : []).map((item) => String(item).slice(0, 180)).filter(Boolean).slice(0, 5),
    limitations: String(parsed.limitations || "搜尋結果不等於抄襲認定；仍需由老師比對原始題源、出版時間與授權狀態。").slice(0, 1200),
    citations,
    searchedAt: new Date().toISOString(),
    model,
    usage: { inputTokens: Number(usageObject.input_tokens ?? 0), outputTokens: Number(usageObject.output_tokens ?? 0), webSearchCalls: 1, estimatedCostUsdMicros },
  };
  await auth.db.insert(medtechQuestionEvidenceReviews).values({
    questionId: id,
    reviewer: auth.member.email,
    provider: "openai_web_search",
    queryText,
    resultJson: JSON.stringify(review),
  });
  await auth.db.insert(usageLogs).values({
    model,
    source: `醫檢師外部證據／相似題查核｜題目 ${id}`,
    inputTokens: review.usage.inputTokens,
    outputTokens: review.usage.outputTokens,
    fileSearchCalls: 0,
    estimatedCostUsdMicros,
  }).catch(() => undefined);
  return Response.json({ review, questionId: id });
}
