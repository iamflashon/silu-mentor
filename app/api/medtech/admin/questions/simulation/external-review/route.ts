import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { examQuestions, medtechQuestionEvidenceReviews, usageLogs } from "../../../../../../../db/schema";
import { requireMedtechQuestionEditor } from "../../../../../../../lib/member-auth";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../../../../../lib/openai";

type Citation = { title: string; url: string };
type EvidenceAttachment = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey?: string;
  url?: string;
};
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
  attachments: EvidenceAttachment[];
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

function clientReview(review: EvidenceReview, questionId: number) {
  return {
    ...review,
    attachments: (Array.isArray(review.attachments) ? review.attachments : []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      url: `/api/medtech/admin/questions/simulation/external-review/attachment?questionId=${questionId}&attachmentId=${encodeURIComponent(attachment.id)}`,
    })),
  };
}

function safeFileName(value: string) {
  return String(value || "evidence-image").replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 90) || "evidence-image";
}

function urlsFromText(value: string) {
  return [...new Set(value.match(/https?:\/\/[^\s<>()\[\]"']+/giu) ?? [])].slice(0, 12).map((url) => ({
    title: "使用者貼上的外部來源",
    url: url.replace(/[.,;，。；、]+$/u, ""),
  }));
}

async function attachmentHistory(db: Awaited<ReturnType<typeof getDb>>, questionId: number) {
  const rows = await db.select({ resultJson: medtechQuestionEvidenceReviews.resultJson })
    .from(medtechQuestionEvidenceReviews)
    .where(eq(medtechQuestionEvidenceReviews.questionId, questionId))
    .orderBy(desc(medtechQuestionEvidenceReviews.createdAt))
    .limit(50);
  const byId = new Map<string, EvidenceAttachment>();
  let latestManualEvidence = "";
  for (const row of rows) {
    const review = parseStored(row.resultJson);
    if (!review) continue;
    if (!latestManualEvidence && review.manualEvidence) latestManualEvidence = review.manualEvidence;
    for (const attachment of Array.isArray(review.attachments) ? review.attachments : []) {
      if (attachment.id && attachment.storageKey && !byId.has(attachment.id)) byId.set(attachment.id, attachment);
    }
  }
  return { attachments: [...byId.values()].slice(0, 12), latestManualEvidence };
}

export async function GET(request: Request) {
  const auth = await requireMedtechQuestionEditor(request);
  if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("questionId"));
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const rows = await auth.db.select().from(medtechQuestionEvidenceReviews)
    .where(eq(medtechQuestionEvidenceReviews.questionId, id))
    .orderBy(desc(medtechQuestionEvidenceReviews.createdAt))
    .limit(1);
  const review = rows[0] ? parseStored(rows[0].resultJson) : null;
  if (!review) return Response.json({ review: null });
  const history = await attachmentHistory(auth.db, id);
  return Response.json({ review: clientReview({ ...review, manualEvidence: review.manualEvidence || history.latestManualEvidence, attachments: history.attachments }, id) });
}

export async function POST(request: Request) {
  const auth = await requireMedtechQuestionEditor(request);
  if ("error" in auth) return auth.error;
  type Body = { id?: number; mode?: "web" | "manual" | "save"; evidenceText?: string; review?: unknown; keepAttachmentIds?: string[] };
  let body: Body;
  let imageFiles: File[] = [];
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await request.formData();
    let keepAttachmentIds: string[] = [];
    try { keepAttachmentIds = JSON.parse(String(form.get("keepAttachmentIds") || "[]")) as string[]; } catch { keepAttachmentIds = []; }
    imageFiles = form.getAll("attachments").filter((item): item is File => typeof item !== "string" && typeof (item as File).stream === "function");
    body = { id: Number(form.get("id")), mode: String(form.get("mode") || "manual") as Body["mode"], evidenceText: String(form.get("evidenceText") || ""), keepAttachmentIds };
  } else {
    body = await request.json() as Body;
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "缺少題目編號" }, { status: 400 });
  const [question] = await auth.db.select().from(examQuestions).where(and(
    eq(examQuestions.id, id),
    eq(examQuestions.examCategory, "medtech"),
    eq(examQuestions.examType, "mcq"),
  )).limit(1);
  if (!question) return Response.json({ error: "找不到醫檢選擇題" }, { status: 404 });

  if (body.mode === "save") {
    if (!body.review || typeof body.review !== "object") return Response.json({ error: "缺少要保存的查核結果。" }, { status: 400 });
    const resultJson = JSON.stringify(body.review);
    if (resultJson.length > 100_000) return Response.json({ error: "查核結果過大，請縮短內容後再保存。" }, { status: 413 });
    const reviewModel = String((body.review as { model?: unknown }).model ?? "");
    await auth.db.insert(medtechQuestionEvidenceReviews).values({
      questionId: id,
      reviewer: auth.member.email,
      provider: reviewModel === "manual" ? "manual_paste" : "openai_web_search",
      queryText: `題目 ${question.questionNumber}｜保存外部查核結果`,
      resultJson,
    });
    return Response.json({ review: body.review, questionId: id, saved: true });
  }

  if (body.mode === "manual") {
    const manualEvidence = String(body.evidenceText ?? "").trim().slice(0, 20_000);
    const history = await attachmentHistory(auth.db, id);
    const keepIds = Array.isArray(body.keepAttachmentIds) ? new Set(body.keepAttachmentIds.map(String)) : new Set(history.attachments.map((attachment) => attachment.id));
    const retainedAttachments = history.attachments.filter((attachment) => keepIds.has(attachment.id));
    if (manualEvidence.length < 10 && retainedAttachments.length === 0 && imageFiles.length === 0) return Response.json({ error: "請先貼上查核文字，或新增至少一張圖片證據。" }, { status: 400 });
    if (imageFiles.length > 12 || retainedAttachments.length + imageFiles.length > 12) return Response.json({ error: "同一題最多保存 12 張圖片證據。" }, { status: 413 });
    const totalImageBytes = imageFiles.reduce((sum, file) => sum + file.size, 0);
    if (imageFiles.some((file) => !file.type.startsWith("image/"))) return Response.json({ error: "人工查核證據目前只接受圖片檔。" }, { status: 415 });
    if (imageFiles.some((file) => file.size < 1 || file.size > 8 * 1024 * 1024) || totalImageBytes > 48 * 1024 * 1024) return Response.json({ error: "每張圖片最多 8MB，這次新增圖片合計最多 48MB。" }, { status: 413 });

    const newAttachments: EvidenceAttachment[] = [];
    const { env } = await import("cloudflare:workers");
    if (imageFiles.length && !env.BUCKET) return Response.json({ error: "圖片儲存空間尚未就緒。" }, { status: 503 });
    try {
      for (const file of imageFiles) {
        const attachmentId = crypto.randomUUID();
        const storageKey = `medtech/evidence/${id}/${attachmentId}-${safeFileName(file.name)}`;
        await env.BUCKET.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { questionId: String(id), attachmentId } });
        newAttachments.push({ id: attachmentId, name: file.name || "查核截圖", contentType: file.type, sizeBytes: file.size, storageKey });
      }
    } catch (error) {
      for (const attachment of newAttachments) await env.BUCKET.delete(attachment.storageKey!).catch(() => undefined);
      return Response.json({ error: error instanceof Error ? error.message : "圖片證據保存失敗。" }, { status: 502 });
    }
    const review: EvidenceReview = {
      questionFound: "unclear",
      answerAssessment: "insufficient",
      answerReason: "這是人工貼上的外部資料與圖片證據，系統沒有替你判定老師或 AI 哪個答案正確。",
      leakageRisk: "insufficient",
      leakageReason: "僅保存查核資料，沒有足夠機制直接認定抄襲或外洩。請由老師比對題幹來源、出版時間與授權狀態。",
      searchSummary: newAttachments.length ? `已保存人工貼上的外部搜尋結果與 ${newAttachments.length} 張圖片證據；未呼叫 AI，也未啟動付費外部搜尋。` : "已保存人工貼上的外部搜尋結果；未呼叫 AI，也未啟動付費外部搜尋。",
      candidateSources: [],
      matchedPhrases: [],
      limitations: "人工貼上內容需要老師自行核對；這筆紀錄不代表外部來源已經驗證。",
      manualEvidence: manualEvidence || "（僅附圖片證據，尚未補充文字說明。）",
      attachments: [...retainedAttachments, ...newAttachments],
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
    return Response.json({ review: clientReview(review, id), questionId: id });
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
    attachments: [],
    citations,
    searchedAt: new Date().toISOString(),
    model,
    usage: { inputTokens: Number(usageObject.input_tokens ?? 0), outputTokens: Number(usageObject.output_tokens ?? 0), webSearchCalls: 1, estimatedCostUsdMicros },
  };
  await auth.db.insert(usageLogs).values({
    model,
    source: `醫檢師外部證據／相似題查核｜題目 ${id}`,
    inputTokens: review.usage.inputTokens,
    outputTokens: review.usage.outputTokens,
    fileSearchCalls: 0,
    estimatedCostUsdMicros,
  }).catch(() => undefined);
  return Response.json({ review: clientReview(review, id), questionId: id });
}
