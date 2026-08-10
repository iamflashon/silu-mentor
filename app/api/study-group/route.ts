import { getDeepSeekKey, getDeepSeekModel, getOpenAIKey } from "../../../lib/openai";

type Member = "luna" | "deepseek" | "terra" | "sol";
type Mood = "quiet" | "natural" | "lively";
type ChatMessage = { speaker: string; text: string };

const roles: Record<Member, string> = {
  luna: "你是 Luna，AI 讀書會的初學同學。親切、好奇、敢問看似簡單但關鍵的問題；用短句、白話與生活例子拆解法律概念，不堆術語。",
  deepseek: "你是 DeepSeek，AI 讀書會的資料整理型同學。勤奮、條理清楚，擅長整理法條、學說與觀點差異；只補充與問題直接相關的資料，不寫成長篇報告。",
  terra: "你是 Terra，AI 讀書會的質疑型同學。直率但不攻擊人，專找推論跳躍、遺漏要件與反例。質疑時必須先明確說出你在質疑哪位成員的哪個說法。",
  sol: "你是 Sol，AI 讀書會的學霸學長。沉穩嚴謹，負責校準法律錯誤，並以爭點、規範、涵攝、結論收束；不要每次都搶著下最終判決。",
};

function chooseSpeaker(question: string): Member {
  if (/白話|不懂|意思|例子|初學/.test(question)) return "luna";
  if (/學說|法條|資料|比較|整理|有哪些/.test(question)) return "deepseek";
  if (/漏洞|質疑|反例|吐槽|不同意|有問題/.test(question)) return "terra";
  if (/考場|擬答|統整|結論|怎麼寫|校準/.test(question)) return "sol";
  return "luna";
}

function extractOpenAIText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? String((part as { text: string }).text) : "");
  }).filter(Boolean).join("\n").trim();
}

async function ask(member: Member, prompt: string) {
  const started = Date.now();
  if (member === "deepseek") {
    const key = await getDeepSeekKey();
    if (!key) throw new Error("DeepSeek 尚未設定");
    const model = await getDeepSeekModel("deepseek-v4-pro");
    const response = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: roles.deepseek }, { role: "user", content: prompt }], max_tokens: 900 }) });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "DeepSeek 暫時無法回應");
    return { speaker: member, text: payload.choices?.[0]?.message?.content?.trim() || "", model, inputTokens: payload.usage?.prompt_tokens || 0, outputTokens: payload.usage?.completion_tokens || 0, durationMs: Date.now() - started };
  }
  const key = await getOpenAIKey();
  if (!key) throw new Error("OpenAI 尚未設定");
  const model = member === "sol" ? "gpt-5.6-sol" : member === "terra" ? "gpt-5.6-terra" : "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, instructions: `${roles[member]}\n你是讀書會成員，不是主持人。每次發言控制在 220 字內。不得假裝查過未提供的教材或判決。`, input: prompt }) });
  const payload = await response.json() as Record<string, unknown> & { usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `${member} 暫時無法回應`);
  return { speaker: member, text: extractOpenAIText(payload), model, inputTokens: payload.usage?.input_tokens || 0, outputTokens: payload.usage?.output_tokens || 0, durationMs: Date.now() - started };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: string; target?: Member | "host" | "free"; mood?: Mood; topic?: string; messages?: ChatMessage[] };
    const question = body.question?.trim() || "";
    if (!question) return Response.json({ error: "請先輸入想討論的內容" }, { status: 400 });
    const history = (body.messages || []).slice(-10).map((item) => `${item.speaker}：${item.text}`).join("\n");
    const named = question.match(/@(Luna|DeepSeek|Terra|Sol)/i)?.[1]?.toLowerCase() as Member | undefined;
    const first = named || (body.target && !["host", "free"].includes(body.target) ? body.target as Member : chooseSpeaker(question));
    const prompt = `本次主題：${body.topic || "依學生今日學習目標討論"}\n先前對話：\n${history || "尚未發言"}\n\n學生現在說：${question}\n請直接接續聊天室對話，不要自稱 AI。`;
    const replies = [await ask(first, prompt)];
    if (body.mood !== "quiet" && body.target !== first) {
      const second: Member | null = body.mood === "lively" ? (first === "terra" ? "sol" : "terra") : /錯|但是|不同意|漏洞|為什麼/.test(replies[0].text) ? "terra" : null;
      if (second && second !== first) {
        const reason = second === "terra" ? `請針對 ${first} 剛才的發言提出一個有學習價值的質疑；先引用被質疑的短句。` : `請校準 ${first} 與 Terra 的討論，指出應保留與修正之處。`;
        replies.push(await ask(second, `${prompt}\n\n${first} 剛才說：${replies[0].text}\n${reason}`));
      }
    }
    return Response.json({ assigned: first, replies });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "讀書會暫時無法回應" }, { status: 500 });
  }
}
