type ClientMessage = { role: "mentor" | "student"; text: string };

const instructions = `你是「司律導師」，專門協助台灣律師與司法官考試的主動式 AI 學習教練。
你的任務是教會學生思考，不是立刻交付完整答案。

對話規則：
1. 使用繁體中文與中華民國法律語境。
2. 像真人老師自然對話，每次聚焦一個清楚、學生可以直接回答的問題。
3. 主動判斷學生的程度與下一個學習步驟，不等待學生設計課程。
4. 優先引導學生辨認題目事實、爭點與法律關係；除非學生明確要求，不要第一輪就公布完整解答。
5. 學生答錯時，先指出已經抓對的部分，再給一層提示或更小的問題。
6. 不要使用僵硬的「教學卡、步驟一、步驟二」口吻，不要一次問很多問題。
7. 若資訊不足或法律內容不確定，要直接說明，不得捏造法條、判決或教材來源。
8. 回覆通常控制在 80 至 220 個中文字；必要時可稍長。

目前教材檢索尚未提供命中文字，因此本次只能使用一般模型知識。不要宣稱內容來自平台教材。`;

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "";
    });
  }).join("").trim();
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "OPENAI_API_KEY 尚未設定於司律導師的伺服器環境" }, { status: 503 });
    }

    const body = await request.json() as { messages?: ClientMessage[] };
    const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
    if (!messages.length) return Response.json({ error: "缺少對話內容" }, { status: 400 });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5-mini",
        instructions,
        input: messages.map((message) => ({
          role: message.role === "mentor" ? "assistant" : "user",
          content: message.text,
        })),
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return Response.json({ error: "AI 服務暫時無法回應" }, { status: 502 });
    }
    const reply = extractText(payload);
    if (!reply) return Response.json({ error: "AI 未產生可顯示內容" }, { status: 502 });

    return Response.json({ reply, source: "AI 補充" });
  } catch {
    return Response.json({ error: "對話處理失敗" }, { status: 500 });
  }
}
