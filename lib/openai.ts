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

export async function getOpenAIModel(fallback = "gpt-5.6-luna") {
  const configured = process.env.OPENAI_MODEL;
  if (configured?.trim()) return configured.trim();
  const env = await runtimeEnv();
  const runtimeModel = env.OPENAI_MODEL;
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
  const response = await fetch(`https://api.openai.com/v1${url}`, {
    ...init,
    headers: { ...(await openAIHeaders(true)), ...(init?.headers ?? {}) },
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const nested = payload.error && typeof payload.error === "object" ? payload.error as { message?: string } : null;
    throw new Error(nested?.message ?? "OpenAI API 請求失敗");
  }
  return payload;
}
