import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { examAttempts, examQuestions, studyRecords, usageLogs } from "../../../db/schema";
import { taipeiDate } from "../../../lib/taipei-time";
import {
  getAnthropicKey,
  getAnthropicModel,
  getEssayOpenAIModel,
  getOpenAIKey,
} from "../../../lib/openai";

type EssayModelMode = "sol" | "claude" | "dual";

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
};

class EssayModelError extends Error {
  status = 502;
}

const gradingInstructions = `你是台灣司律二試申論閱卷教練。必須以「高點名師參考擬答」及其明確評分重點作為主要核對依據，但不能用文字相似度代替法律評價。請檢查學生是否審對題目、列出關鍵爭點、使用正確規範、完成事實涵攝、提出結論，並檢查架構與表達。老師擬答是參考解答，不是唯一文字答案；學生採不同但有法律理由的見解時，應標示為可接受或需補強，不要直接判錯。只根據題目、老師擬答與提供的評分點，不能補造未提供的老師見解。回覆繁體中文，分項指出學生原文證據、漏寫點與下一個修正動作。

批改結果必須包含 solution_steps，固定依序提供 5 個解題過程步驟：1 審題與定位問題、2 爭點拆解、3 規範與要件、4 事實涵攝、5 結論與作答整理。每一步都要說明本步在處理什麼、學生目前做到什麼、依題目與參考擬答應如何推理，以及下一個可立即修正的動作；不能只列標題或重複總評。`;

const gradingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer" },
    overall: { type: "string" },
    solution_steps: {
      type: "array",
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
  if (value.solution_steps.length < 2 || value.solution_steps.length > 5) {
    throw new Error("AI 回傳的解題步驟數量不完整（應為 2 至 5 步）");
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

function parseModelGrading(modelLabel: string, raw: string) {
  try {
    return parseEssayGrading(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "回傳格式不完整";
    throw new EssayModelError(`${modelLabel}：${detail}`);
  }
}

function gradingInput(question: {
  stem: string;
  teacherAnswer: string;
  teacherNotes: string;
  rubricJson: string;
}, answer: string) {
  return JSON.stringify(
    {
      question: question.stem,
      teacher_answer: question.teacherAnswer,
      teacher_notes: question.teacherNotes,
      rubric: parseRubric(question.rubricJson),
      student_answer: answer,
    },
    null,
    2,
  );
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
      max_output_tokens: 12000,
    }),
  });
  const payload = await readModelPayload(response) as {
    output?: unknown[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new EssayModelError(`GPT-5.6 Sol：${modelErrorMessage(payload, "申論批改失敗")}`);
  }
  return {
    model,
    grading: parseModelGrading("GPT-5.6 Sol", responseText(payload)),
    inputTokens: Number(payload.usage?.input_tokens ?? 0),
    outputTokens: Number(payload.usage?.output_tokens ?? 0),
    cachedTokens: Number(payload.usage?.input_tokens_details?.cached_tokens ?? 0),
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
      max_tokens: 12000,
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
    throw new EssayModelError(`Claude Opus 5：${modelErrorMessage(payload, "申論批改失敗")}`);
  }
  if (payload.stop_reason === "max_tokens") {
    throw new EssayModelError("Claude Opus 5：回覆被截斷，尚未完成完整批改");
  }
  return {
    model: payload.model || model,
    grading: parseModelGrading("Claude Opus 5", anthropicText(payload)),
    inputTokens: Number(payload.usage?.input_tokens ?? 0),
    outputTokens: Number(payload.usage?.output_tokens ?? 0),
    cachedTokens: 0,
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

function estimatedOpenAICost(inputTokens: number, cachedTokens: number, outputTokens: number) {
  return Math.round(((Math.max(0, inputTokens - cachedTokens) * 2.5 + cachedTokens * 0.25 + outputTokens * 15) / 1_000_000) * 1_000_000);
}

function estimatedAnthropicCost(inputTokens: number, outputTokens: number) {
  return Math.round(((inputTokens * 5 + outputTokens * 25) / 1_000_000) * 1_000_000);
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
      }];
    });
    return Response.json({ attempts });
  } catch {
    return Response.json({ error: "申論批改紀錄暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { questionId?: number; answer?: string; mode?: EssayModelMode };
    const questionId = Number(body.questionId);
    const answer = String(body.answer ?? "").trim();
    if (body.mode !== "sol" && body.mode !== "claude" && body.mode !== "dual") {
      return Response.json({ error: "請先選擇申論批改模型" }, { status: 400 });
    }
    const mode: EssayModelMode = body.mode;
    if (!Number.isInteger(questionId) || !answer) return Response.json({ error: "請提供題目與申論作答內容" }, { status: 400 });

    const openAIKey = mode === "claude" ? "" : await getOpenAIKey();
    const anthropicKey = mode === "sol" ? "" : await getAnthropicKey();
    if (!openAIKey && mode !== "claude") return Response.json({ error: "OPENAI_API_KEY 尚未設定" }, { status: 503 });
    if (!anthropicKey && mode !== "sol") return Response.json({ error: "ANTHROPIC_API_KEY 尚未設定" }, { status: 503 });

    const db = await getDb();
    const [question] = await db
      .select()
      .from(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.examType, "essay"), eq(examQuestions.status, "published")))
      .limit(1);
    if (!question) return Response.json({ error: "找不到已發布的二試申論題" }, { status: 404 });
    if (!question.teacherAnswer.trim()) return Response.json({ error: "這題尚未完成老師擬答核對，暫不能進行依擬答批改。" }, { status: 409 });

    const solModel = await getEssayOpenAIModel("gpt-5.6-sol");
    const claudeModel = await getAnthropicModel("claude-opus-5");
    const runs: ModelRun[] = [];
    if (mode === "sol") runs.push(await runSol(openAIKey, solModel, question, answer));
    if (mode === "claude") runs.push(await runClaude(anthropicKey, claudeModel, question, answer));
    if (mode === "dual") {
      const [sol, claude] = await Promise.all([
        runSol(openAIKey, solModel, question, answer),
        runClaude(anthropicKey, claudeModel, question, answer),
      ]);
      runs.push(sol, claude);
    }

    const solRun = runs.find((run) => run.model === solModel) ?? (mode === "claude" ? undefined : runs[0]);
    const claudeRun = runs.find((run) => run.model === claudeModel) ?? (mode === "claude" ? runs[0] : undefined);
    const primary = mode === "claude" ? claudeRun : solRun;
    if (!primary) throw new Error("沒有取得申論批改結果");
    const comparison = mode === "dual" && solRun && claudeRun ? compareGradings(solRun.grading, claudeRun.grading) : null;
    const storedGrading = mode === "dual"
      ? { mode, sol: solRun?.grading, claude: claudeRun?.grading, comparison }
      : { mode, model: primary.model, grading: primary.grading };

    await db.insert(examAttempts).values({ userKey: userKey(request), questionId, selectedAnswer: null, correct: null, answerText: answer, gradingJson: JSON.stringify(storedGrading) });
    const date = taipeiDate();
    await db.insert(studyRecords).values({ userKey: userKey(request), questionId, recordDate: date, subject: question.subject, title: `${question.year} 第 ${question.questionNumber} 題`, activityType: "二試申論批改", correct: null, reflection: primary.grading.overall.slice(0, 1000), weakness: primary.grading.priority_fixes.join("；").slice(0, 500), nextStep: primary.grading.next_step.slice(0, 500) });
    for (const run of runs) {
      await db.insert(usageLogs).values({
        model: run.model,
        source: mode === "dual" ? `二試申論批改（${run.model === solModel ? "Sol" : "Claude"}）` : "二試申論批改",
        inputTokens: run.inputTokens,
        cachedTokens: run.cachedTokens,
        outputTokens: run.outputTokens,
        fileSearchCalls: 0,
        estimatedCostUsdMicros: run.model === solModel
          ? estimatedOpenAICost(run.inputTokens, run.cachedTokens, run.outputTokens)
          : estimatedAnthropicCost(run.inputTokens, run.outputTokens),
      });
    }

    return Response.json({
      mode,
      saved: true,
      grading: primary.grading,
      reviews: mode === "dual" ? { sol: solRun?.grading, claude: claudeRun?.grading } : undefined,
      comparison,
      models: { sol: solRun?.model ?? solModel, claude: claudeRun?.model ?? claudeModel },
      source: { label: question.answerSource || "高點名師參考擬答", status: question.answerStatus },
    });
  } catch (error) {
    const status = error instanceof EssayModelError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "AI 申論批改失敗" }, { status });
  }
}
