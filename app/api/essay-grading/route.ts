import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { examAttempts, examQuestions, studyRecords, usageLogs } from "../../../db/schema";
import { taipeiDate } from "../../../lib/taipei-time";
import {
  getAnthropicKey,
  getAnthropicModel,
  getEssayOpenAIModel,
  getOpenAIKey,
} from "../../../lib/openai";
import { estimateCostUsdMicros } from "../../../lib/usage";
import { relevantSections } from "../../../lib/input-budget";

type EssayModelMode = "luna" | "sol" | "claude" | "dual";

type EssayGrading = {
  score: number;
  overall: string;
  solution_steps: Array<{
    step: number;
    title: string;
    focus: string;
    analysis: string;
    student_performance: string;
    next_action: string;
  }>;
  dimensions: Array<{
    criterion: string;
    score: number;
    max_score: number;
    result: string;
    evidence: string;
    missing: string;
  }>;
  strengths: string[];
  priority_fixes: string[];
  next_step: string;
  source_used: string;
};

type ModelRun = {
  model: string;
  grading: EssayGrading;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUsdMicros: number;
};

type ModelFailure = {
  model: "sol" | "claude";
  label: string;
  message: string;
  retryable: boolean;
};

class EssayModelError extends Error {
  constructor(
    message: string,
    public status = 502,
    public model: "sol" | "claude" = "sol",
    public retryable = false,
  ) {
    super(message);
    this.name = "EssayModelError";
  }
}

const gradingInstructions = `你是台灣司律二試申論診斷教練。你的任務是診斷學生原答案，不是重新生成答案。必須依序以老師評分要點、老師擬答／解析、指定解題書與歷屆評分資料作為核對基準；本次實際提供何種資料，就只能使用該資料，不得補造未提供的老師見解或自行改採另一套學說。不能用文字相似度代替法律評價。學生採不同但有法律理由的見解時，應標示為可接受或需補強，不要直接判錯。回覆繁體中文。

評分必須使用題目提供的 original_max_score，不得自行改成百分制。dimensions 各項 max_score 合計必須等於 original_max_score，score 必須等於 dimensions 各項 score 合計。若老師未提供細項配分，才可在 original_max_score 內合理分配，但不得改變總滿分。不得另寫一份 AI 建議擬答；任務只有依老師擬答分析學生的答對、漏寫、寫錯與修正方向。

dimensions 必須固定依序輸出且只能輸出以下六項：1 標題、2 結論、3 爭點完整度、4 論證順序、5 規範與涵攝、6 文字得分效果。每項 result 只寫「已做到」「部分做到」「寫錯」或「遺漏」；evidence 以一至二句引用或準確摘述學生原文，沒有對應內容就寫「學生原文未見」；missing 以一至二句說明與老師基準的差距及最直接的補強方式，不得代寫整段答案。特別檢查：標題是否直接呈現法律問題及結論、是否先處理核心爭點、結論是否明確且前後一致、是否只有背誦學說而缺乏具體事實涵攝、推論是否跳躍、同一法律爭點改變問法後是否仍有正確辨識。

若學生的核心罪名、法條、行為人定位或罪數處理大幅偏離老師擬答，爭點完整度與規範涵攝不得因文字很多或曾提及相近概念而給過半分；只有具體且正確連結到老師得分點的內容才能計分。但學生提出有法律理由的不同見解時，不得僅因與老師採說不同就判零分，應說明依本題老師基準會如何影響得分。overall 第一段必須以「以下評價僅依本題老師擬答，不代表否定其他法規適用可能性。」開頭，之後最多再寫兩句總評。priority_fixes 最多三項，每項只寫一個最高優先錯誤；next_step 只寫一句可立即執行的練習。strengths 最多兩項。solution_steps 一律回傳空陣列，不再產出推論鏈檢查，避免與六項診斷重複。整份批改以約 1200 至 1800 個輸出 tokens 為目標，只提供診斷與修正順序，不得生成完整答案。`;

const gradingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer" },
    overall: { type: "string" },
    solution_steps: {
      type: "array",
      description: "固定回傳空陣列；本版不再產出與六項診斷重複的推論鏈。",
      maxItems: 0,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          step: { type: "integer" },
          title: { type: "string" },
          focus: { type: "string" },
          analysis: { type: "string" },
          student_performance: { type: "string" },
          next_action: { type: "string" },
        },
        required: ["step", "title", "focus", "analysis", "student_performance", "next_action"],
      },
    },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterion: { type: "string" },
          score: { type: "integer" },
          max_score: { type: "integer" },
          result: { type: "string" },
          evidence: { type: "string" },
          missing: { type: "string" },
        },
        required: ["criterion", "score", "max_score", "result", "evidence", "missing"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    priority_fixes: { type: "array", items: { type: "string" } },
    next_step: { type: "string" },
    source_used: { type: "string" },
  },
  required: ["score", "overall", "solution_steps", "dimensions", "strengths", "priority_fixes", "next_step", "source_used"],
} as const;

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) =>
      item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
        ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "")
        : [],
    )
    .join("")
    .trim();
}

function anthropicText(payload: unknown) {
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

function parseRubric(raw: string) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function parseEssayGrading(raw: string) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未回傳可解析的申論批改結果");
  const value = JSON.parse(cleaned.slice(start, end + 1)) as Partial<EssayGrading>;
  if (
    typeof value.score !== "number" ||
    typeof value.overall !== "string" ||
    !Array.isArray(value.solution_steps) ||
    !Array.isArray(value.dimensions) ||
    !Array.isArray(value.strengths) ||
    !Array.isArray(value.priority_fixes) ||
    typeof value.next_step !== "string" ||
    typeof value.source_used !== "string"
  ) {
    throw new Error("AI 回傳的申論批改格式不完整");
  }
  if (value.solution_steps.length !== 0) {
    throw new Error("AI 回傳了本版已取消的重複推論鏈");
  }
  for (const [index, step] of value.solution_steps.entries()) {
    if (
      !step ||
      typeof step !== "object" ||
      !Number.isInteger(step.step) ||
      typeof step.title !== "string" ||
      typeof step.focus !== "string" ||
      typeof step.analysis !== "string" ||
      typeof step.student_performance !== "string" ||
      typeof step.next_action !== "string"
    ) {
      throw new Error(`AI 回傳的第 ${index + 1} 個解題步驟格式不完整`);
    }
  }
  return value as EssayGrading;
}

async function readModelPayload(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new EssayModelError(`模型服務回傳非 JSON（HTTP ${response.status}）`);
  }
}

function modelErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return fallback;
}

function isRetryableModelFailure(status: number, message: string) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 529 || /overloaded|rate.?limit|temporarily unavailable|service unavailable/i.test(message);
}

function modelFailure(error: unknown, fallbackModel: "sol" | "claude"): ModelFailure {
  if (error instanceof EssayModelError) {
    return {
      model: error.model,
      label: error.model === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna",
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    model: fallbackModel,
    label: fallbackModel === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna",
    message: (fallbackModel === "claude" ? "Claude Opus 5" : "GPT-5.6 Luna") + "：批改暫時失敗，請稍後重試。",
    retryable: true,
  };
}

function parseModelGrading(modelLabel: string, raw: string) {
  try {
    return parseEssayGrading(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "回傳格式不完整";
    throw new EssayModelError(`${modelLabel}：${detail}`);
  }
}

function originalMaxScore(question: { stem: string; rubricJson: string }) {
  const rubric = parseRubric(question.rubricJson);
  const rubricTotal = rubric.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const raw = item as Record<string, unknown>;
    const value = Number(raw.max_score ?? raw.maxScore ?? raw.score ?? raw.points ?? 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  if (rubricTotal > 0) return rubricTotal;
  const matches = [...question.stem.matchAll(/[（(]\s*(\d{1,3})\s*分\s*[）)]/g)];
  const stated = Number(matches.at(-1)?.[1] ?? 0);
  return stated > 0 ? stated : 100;
}

function gradingInput(question: {
  stem: string;
  teacherAnswer: string;
  teacherNotes: string;
  rubricJson: string;
}, answer: string) {
  const rubric = parseRubric(question.rubricJson);
  const maxScore = originalMaxScore(question);
  return JSON.stringify(
    {
      question: question.stem,
      teacher_answer: relevantSections(question.teacherAnswer, `${question.stem}\n${answer}`, 9000),
      teacher_notes: relevantSections(question.teacherNotes, `${question.stem}\n${answer}`, 2500),
      rubric,
      original_max_score: maxScore,
      student_answer: answer,
    },
    null,
    2,
  );
}

function normalizeGradingScale(grading: EssayGrading, question: { stem: string; rubricJson: string }) {
  const maxScore = originalMaxScore(question);
  const dimensionScore = grading.dimensions.reduce((sum, item) => sum + Math.max(0, Math.min(Number(item.score) || 0, Number(item.max_score) || 0)), 0);
  return { ...grading, score: Math.min(maxScore, dimensionScore), max_score: maxScore } as EssayGrading & { max_score: number };
}

async function runSol(
  apiKey: string,
  model: string,
  question: Parameters<typeof gradingInput>[0],
  answer: string,
): Promise<ModelRun> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: gradingInstructions,
      input: [{ role: "user", content: [{ type: "input_text", text: gradingInput(question, answer) }] }],
      text: { format: { type: "json_schema", name: "essay_grading", strict: true, schema: gradingSchema } },
      max_output_tokens: 2600,
    }),
  });
  const payload = await readModelPayload(response) as {
    output?: unknown[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    error?: { message?: string };
  };
  if (!response.ok) {
    const detail = modelErrorMessage(payload, "申論批改失敗");
    throw new EssayModelError(`GPT-5.6 Luna：${detail}`, response.status, "sol", isRetryableModelFailure(response.status, detail));
  }
  return {
    model,
    grading: parseModelGrading("GPT-5.6 Luna", responseText(payload)),
    inputTokens: Number(payload.usage?.input_tokens ?? 0),
    outputTokens: Number(payload.usage?.output_tokens ?? 0),
    cachedTokens: Number(payload.usage?.input_tokens_details?.cached_tokens ?? 0),
    estimatedCostUsdMicros: estimateCostUsdMicros(model, {
      inputTokens: Number(payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.output_tokens ?? 0),
      cachedTokens: Number(payload.usage?.input_tokens_details?.cached_tokens ?? 0),
    }),
  };
}

async function runClaude(
  apiKey: string,
  model: string,
  question: Parameters<typeof gradingInput>[0],
  answer: string,
): Promise<ModelRun> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2600,
      system: `${gradingInstructions}\n\n只輸出合法 JSON，不要輸出 Markdown、說明文字或 JSON 以外的內容。JSON 欄位必須完全使用 score、overall、solution_steps、dimensions、strengths、priority_fixes、next_step、source_used。`,
      messages: [{ role: "user", content: gradingInput(question, answer) }],
      output_config: { format: { type: "json_schema", schema: gradingSchema } },
    }),
  });
  const payload = await readModelPayload(response) as {
    model?: string;
    content?: unknown[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
    stop_reason?: string;
  };
  if (!response.ok) {
    const detail = modelErrorMessage(payload, "申論批改失敗");
    const retryable = isRetryableModelFailure(response.status, detail);
    const message = /overloaded/i.test(detail) || response.status === 529
      ? "Claude Opus 5 目前服務繁忙（Overloaded），請稍後重試。"
      : `Claude Opus 5：${detail}`;
    throw new EssayModelError(message, retryable ? 503 : 502, "claude", retryable);
  }
  if (payload.stop_reason === "max_tokens") {
    throw new EssayModelError("Claude Opus 5：回覆被截斷，尚未完成完整批改", 502, "claude");
  }
  return {
    model: payload.model || model,
    grading: parseModelGrading("Claude Opus 5", anthropicText(payload)),
    inputTokens: Number(payload.usage?.input_tokens ?? 0),
    outputTokens: Number(payload.usage?.output_tokens ?? 0),
    cachedTokens: 0,
    estimatedCostUsdMicros: estimateCostUsdMicros(payload.model || model, {
      inputTokens: Number(payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.output_tokens ?? 0),
      cachedTokens: 0,
    }),
  };
}

function compareGradings(sol: EssayGrading, claude: EssayGrading) {
  const solByCriterion = new Map(sol.dimensions.map((item) => [item.criterion, item]));
  const agreements: string[] = [];
  const differences: Array<{ criterion: string; sol: number; claude: number }> = [];
  for (const item of claude.dimensions) {
    const solItem = solByCriterion.get(item.criterion);
    if (!solItem) {
      differences.push({ criterion: item.criterion, sol: 0, claude: item.score });
    } else if (solItem.score === item.score) {
      agreements.push(`${item.criterion}（${item.score}/${item.max_score}）`);
    } else {
      differences.push({ criterion: item.criterion, sol: solItem.score, claude: item.score });
    }
  }
  return {
    scoreDifference: Math.abs(sol.score - claude.score),
    agreements,
    differences,
  };
}

function parseStoredGrading(raw: string) {
  try {
    return JSON.parse(raw) as {
      mode?: EssayModelMode;
      model?: string;
      grading?: EssayGrading;
      sol?: EssayGrading;
      claude?: EssayGrading;
      comparison?: ReturnType<typeof compareGradings> | null;
      failures?: ModelFailure[];
      usage?: Array<Pick<ModelRun, "model" | "inputTokens" | "cachedTokens" | "outputTokens" | "estimatedCostUsdMicros">>;
      solUsage?: Pick<ModelRun, "model" | "inputTokens" | "cachedTokens" | "outputTokens" | "estimatedCostUsdMicros">;
      claudeUsage?: Pick<ModelRun, "model" | "inputTokens" | "cachedTokens" | "outputTokens" | "estimatedCostUsdMicros">;
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const rows = await db
      .select({
        attemptId: examAttempts.id,
        questionId: examQuestions.id,
        year: examQuestions.year,
        subject: examQuestions.subject,
        questionNumber: examQuestions.questionNumber,
        stem: examQuestions.stem,
        answerText: examAttempts.answerText,
        gradingJson: examAttempts.gradingJson,
        createdAt: examAttempts.createdAt,
      })
      .from(examAttempts)
      .innerJoin(examQuestions, eq(examAttempts.questionId, examQuestions.id))
      .where(
        and(
          eq(examAttempts.userKey, userKey(request)),
          eq(examQuestions.examType, "essay"),
          isNotNull(examAttempts.answerText),
        ),
      )
      .orderBy(desc(examAttempts.createdAt))
      .limit(50);

    const attempts = rows.flatMap((row) => {
      const stored = parseStoredGrading(row.gradingJson);
      if (!stored) return [];
      return [{
        id: row.attemptId,
        questionId: row.questionId,
        year: row.year,
        subject: row.subject,
        questionNumber: row.questionNumber,
        stem: row.stem,
        answer: row.answerText ?? "",
        savedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
        mode: stored.mode ?? "sol",
        model: stored.model,
        grading: stored.grading,
        reviews: stored.mode === "dual" ? { sol: stored.sol, claude: stored.claude } : undefined,
        comparison: stored.comparison ?? null,
        modelFailures: stored.failures ?? [],
        usage: stored.usage ?? (stored.mode === "dual"
          ? [stored.solUsage, stored.claudeUsage].filter(Boolean)
          : stored.usage ? [stored.usage] : []),
      }];
    });
    return Response.json({ attempts });
  } catch {
    return Response.json({ error: "申論批改紀錄暫時無法讀取" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
      : [];
    if (!ids.length) return Response.json({ error: "請先選擇要刪除的批改紀錄" }, { status: 400 });

    const db = await getDb();
    await db.delete(examAttempts).where(and(
      eq(examAttempts.userKey, userKey(request)),
      inArray(examAttempts.id, ids),
    ));
    return Response.json({ deleted: ids.length });
  } catch {
    return Response.json({ error: "批改紀錄刪除失敗" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; answer?: string; mode?: EssayModelMode };
    const questionId = Number(body.questionId);
    const answer = String(body.answer ?? "").trim();
    // 正式申論批改固定使用 Luna。即使舊頁面或舊快取仍送出 sol／dual，
    // 也只執行一次 Luna，避免額外模型成本。
    const mode: EssayModelMode = "luna";
    if (!Number.isInteger(questionId) || !answer) return Response.json({ error: "請提供題目與申論作答內容" }, { status: 400 });

    const openAIKey = await getOpenAIKey();
    if (!openAIKey) return Response.json({ error: "OPENAI_API_KEY 尚未設定" }, { status: 503 });

    const db = await getDb();
    const [question] = await db
      .select()
      .from(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examType, "essay"), eq(examQuestions.status, "published")))
      .limit(1);
    if (!question) return Response.json({ error: "找不到已發布的二試申論題" }, { status: 404 });
    if (!question.teacherAnswer.trim()) return Response.json({ error: "這題尚未完成老師擬答核對，暫不能進行依擬答批改。" }, { status: 409 });

    const solModel = await getEssayOpenAIModel("gpt-5.6-luna");
    const runs: ModelRun[] = [];
    const failures: ModelFailure[] = [];
    runs.push(await runSol(openAIKey, solModel, question, answer));

    const solRun = runs.find((run) => run.model === solModel) ?? (mode === "claude" ? undefined : runs[0]);
    const claudeRun = undefined;
    const primary = solRun;
    if (!primary) {
      const failure = failures[0];
      if (failure) throw new EssayModelError(failure.message, failure.retryable ? 503 : 502, failure.model, failure.retryable);
      throw new Error("沒有取得申論批改結果");
    }
    for (const run of runs) run.grading = normalizeGradingScale(run.grading, question);
    const comparison = mode === "dual" && solRun && claudeRun ? compareGradings(solRun.grading, claudeRun.grading) : null;
    const usage = runs.map((run) => ({
      model: run.model,
      inputTokens: run.inputTokens,
      cachedTokens: run.cachedTokens,
      outputTokens: run.outputTokens,
      estimatedCostUsdMicros: run.estimatedCostUsdMicros,
    }));
    const storedGrading = mode === "dual"
      ? { mode, sol: solRun?.grading, claude: claudeRun?.grading, comparison, failures, usage, solUsage: solRun && usage.find((item) => item.model === solRun.model), claudeUsage: claudeRun && usage.find((item) => item.model === claudeRun.model) }
      : { mode, model: primary.model, grading: primary.grading, usage };

    await db.insert(examAttempts).values({ userKey: userKey(request), questionId, selectedAnswer: null, correct: null, answerText: answer, gradingJson: JSON.stringify(storedGrading) });
    const date = taipeiDate();
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: date, subject: question.subject, title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "二試申論批改", correct: null, reflection: primary.grading.overall.slice(0, 1000), weakness: primary.grading.priority_fixes.join("；").slice(0, 500), nextStep: primary.grading.next_step.slice(0, 500) });
    for (const run of runs) {
      await db.insert(usageLogs).values({
        model: run.model,
        source: "二試申論批改（Luna）",
        inputTokens: run.inputTokens,
        cachedTokens: run.cachedTokens,
        outputTokens: run.outputTokens,
        fileSearchCalls: 0,
        estimatedCostUsdMicros: run.estimatedCostUsdMicros,
      });
    }

    return Response.json({
      mode,
      saved: true,
      grading: primary.grading,
      reviews: mode === "dual" ? { sol: solRun?.grading, claude: claudeRun?.grading } : undefined,
      comparison,
      usage,
      modelFailures: failures,
      models: { sol: solRun?.model ?? solModel, claude: claudeRun?.model ?? claudeModel },
      source: { label: question.answerSource || "高點名師參考擬答", status: question.answerStatus },
    });
  } catch (error) {
    const status = error instanceof EssayModelError ? error.status : 500;
    const failure = error instanceof EssayModelError ? modelFailure(error, error.model) : undefined;
    return Response.json({
      error: error instanceof Error ? error.message : "AI 申論批改失敗",
      retryable: failure?.retryable ?? false,
      failedModel: failure?.model,
    }, { status });
  }
}
