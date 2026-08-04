export function openAIHeaders(json = true) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 尚未設定");
  return {
    authorization: `Bearer ${apiKey}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function openAIJson(url: string, init?: RequestInit) {
  const response = await fetch(`https://api.openai.com/v1${url}`, {
    ...init,
    headers: { ...openAIHeaders(true), ...(init?.headers ?? {}) },
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const nested = payload.error && typeof payload.error === "object" ? payload.error as { message?: string } : null;
    throw new Error(nested?.message ?? "OpenAI API 請求失敗");
  }
  return payload;
}
