type RuntimeEnv = Record<string, unknown>;

async function runtimeEnv(): Promise<RuntimeEnv> {
  try {
    const module = await import("cloudflare:workers") as { env?: RuntimeEnv };
    return module.env ?? {};
  } catch {
    return {};
  }
}

export async function getOpenAIKey() {
  const configured = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeKey = env.OPENAI_API_KEY || env.OPENAI_KEY;
  return typeof runtimeKey === "string" ? runtimeKey.trim() : "";
}

export async function getAnthropicKey() {
  const configured = process.env.ANTHROPIC_API_KEY;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeKey = env.ANTHROPIC_API_KEY;
  return typeof runtimeKey === "string" ? runtimeKey.trim() : "";
}

export async function getDeepSeekKey() {
  const configured = process.env.DEEPSEEK_API_KEY;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeKey = env.DEEPSEEK_API_KEY;
  return typeof runtimeKey === "string" ? runtimeKey.trim() : "";
}

export async function getZaiKey() {
  const configured = process.env.ZAI_API_KEY || process.env["GLM-4.7-Flash"];
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeKey = env.ZAI_API_KEY || env["GLM-4.7-Flash"];
  return typeof runtimeKey === "string" ? runtimeKey.trim() : "";
}

export async function getZaiModel(fallback = "glm-4.7-flash") {
  const configured = process.env.ZAI_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.ZAI_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim() ? runtimeModel.trim() : fallback;
}

export async function getOpenAIModel(fallback = "gpt-5.6-luna") {
  const configured = process.env.OPENAI_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.OPENAI_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim() ? runtimeModel.trim() : fallback;
}

/**
 * Essay grading has its own model choice. The general OPENAI_MODEL setting is
 * used by the rest of the site and must not silently change the default Sol
 * grader.
 */
export async function getEssayOpenAIModel(fallback = "gpt-5.6-sol") {
  const configured = process.env.OPENAI_ESSAY_GRADING_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.OPENAI_ESSAY_GRADING_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim()
    ? runtimeModel.trim()
    : fallback;
}

/**
 * Teaching comparisons need an independent, stronger judge. Keep this
 * separate from the general Luna tutor and the essay-grading model so a
 * setting change in either workflow cannot silently weaken the verdict.
 */
export async function getTeachingJudgeOpenAIModel(fallback = "gpt-5.6-sol") {
  const configured = process.env.OPENAI_TEACHING_JUDGE_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.OPENAI_TEACHING_JUDGE_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim()
    ? runtimeModel.trim()
    : fallback;
}

export async function getAnthropicModel(fallback = "claude-opus-5") {
  const configured = process.env.ANTHROPIC_ESSAY_GRADING_MODEL || process.env.ANTHROPIC_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.ANTHROPIC_ESSAY_GRADING_MODEL || env.ANTHROPIC_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim() ? runtimeModel.trim() : fallback;
}

/**
 * The general tutor comparison has its own Anthropic setting so changing the
 * essay grader does not silently change the front-end model experiment.
 */
export async function getAnthropicChatModel(fallback = "claude-sonnet-5") {
  const configured = process.env.ANTHROPIC_CHAT_MODEL || process.env.ANTHROPIC_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.ANTHROPIC_CHAT_MODEL || env.ANTHROPIC_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim() ? runtimeModel.trim() : fallback;
}

export async function getDeepSeekModel(fallback = "deepseek-v4-pro") {
  const configured = process.env.DEEPSEEK_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.DEEPSEEK_MODEL;
  return typeof runtimeModel === "string" && runtimeModel.trim() ? runtimeModel.trim() : fallback;
}

export async function openAIHeaders(json = true) {
  const apiKey = await getOpenAIKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  return {
    authorization: `Bearer ${apiKey}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function openAIJson(url: string, init?: RequestInit) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`https://api.openai.com/v1${url}`, {
      ...init,
      headers: { ...(await openAIHeaders(true)), ...(init?.headers ?? {}) },
    });
    const payload = await response.json() as Record<string, unknown>;
    if (response.ok) return payload;

    const nested = payload.error && typeof payload.error === "object"
      ? payload.error as { message?: string; type?: string; code?: string }
      : null;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      if (response.status === 429) {
        throw new Error("教材解析目前較忙，系統已保留原資料；請稍後再繼續解析。");
      }
      throw new Error(nested?.message ?? "OpenAI API 請求失敗");
    }

    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter && Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000
      : 0;
    const messageWait = nested?.message?.match(/try again in\s+([\d.]+)(ms|s)/i);
    const messageWaitMs = messageWait
      ? Number(messageWait[1]) * (messageWait[2].toLowerCase() === "s" ? 1000 : 1)
      : 0;
    const backoffMs = Math.min(15_000, 750 * 2 ** (attempt - 1));
    const waitMs = Math.max(retryAfterMs, messageWaitMs, backoffMs) + 250;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new Error("OpenAI API 請求失敗");
}
