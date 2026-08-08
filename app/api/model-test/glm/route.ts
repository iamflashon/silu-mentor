import { getZaiKey, getZaiModel } from "../../../../lib/openai";

type ZaiPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

export async function POST() {
  const apiKey = await getZaiKey();
  if (!apiKey) return Response.json({ error: "尚未讀到 ZAI_API_KEY；請確認金鑰已啟用並重新部署。" }, { status: 503 });

  const model = await getZaiModel();
  const startedAt = Date.now();
  try {
    const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "請只用繁體中文回答：司律備考 GLM 連線測試成功。" }],
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: 256,
      }),
    });
    const payload = await response.json().catch(() => ({})) as ZaiPayload;
    if (!response.ok) {
      const detail = payload.error?.message?.slice(0, 180) || `HTTP ${response.status}`;
      return Response.json({ error: `GLM 連線失敗：${detail}` }, { status: response.status });
    }
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) return Response.json({ error: "GLM 已連線，但沒有產生可顯示內容。" }, { status: 502 });
    return Response.json({
      ok: true,
      model: payload.model || model,
      text,
      inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
      outputTokens: Number(payload.usage?.completion_tokens ?? 0),
      totalTokens: Number(payload.usage?.total_tokens ?? 0),
      durationMs: Date.now() - startedAt,
      estimatedCostUsd: 0,
    });
  } catch {
    return Response.json({ error: "目前無法連到 Z.AI，請稍後再試。" }, { status: 502 });
  }
}
