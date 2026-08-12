import { getDb } from "../../../../db";
import { usageLogs } from "../../../../db/schema";
import { getOpenAIKey, getOpenAIModel } from "../../../../lib/openai";
import { requireAdmin } from "../../../../lib/member-auth";

type TeacherResponse = { label?: string; model?: string; text?: string; error?: string | null };
type TeachingLevel = "beginner" | "intermediate" | "advanced" | "super";

function selectedOptionFromContext(prompt: string, teacherText: string) {
  const context = `${teacherText}\n${prompt}`;
  const matches = [...context.matchAll(/(?:為什麼|理由|選擇|我選|選了|選)\s*[「『"']?([ABCD])[」』"']?/giu)];
  return matches.at(-1)?.[1]?.toUpperCase() ?? "";
}

function optionTextFromQuestion(question: string, option: string) {
  if (!option) return "";
  const match = question.match(new RegExp(`(?:^|\\n)\\s*${option}\\s*[.．、:]?\\s*(.+?)(?=\\n\\s*[ABCD]\\s*[.．、:]?\\s*|$)`, "isu"));
  return match?.[1]?.trim() ?? "";
}

function meaningfulOptionNgrams(optionText: string) {
  const compact = optionText.replace(/[\s，。；：、（）()「」『』！？,.!?]/gu, "");
  const excluded = new Set(["法院", "被告", "題目", "規定", "情形", "可以", "不得", "應該", "現在", "另因", "有罪", "宣告", "法律", "關係", "權利", "義務"]);
  const grams = new Set<string>();
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      const gram = compact.slice(index, index + size);
      if (!excluded.has(gram)) grams.add(gram);
    }
  }
  return [...grams];
}

function concretelyAddressesOption(reply: string, optionText: string) {
  if (!optionText) return true;
  const genericOnly = /^(?:我選\s*[ABCD][，,。\s]*)?(?:因為)?(?:這個選項|該選項|題目所載|題目中的關鍵文字|當事人間|依該法律關係|符合題意|符合題目|法律關係合理|處理方式正確|應依實際情況判斷|負擔相應權利義務)[\s\S]{0,80}$/u;
  if (genericOnly.test(reply.trim())) return false;
  const hits = meaningfulOptionNgrams(optionText).filter((gram) => reply.includes(gram));
  return hits.some((gram) => gram.length >= 4) || new Set(hits.filter((gram) => gram.length >= 2)).size >= 2;
}

function isInitialChoiceReasonRequest(teacherText: string, selectedOption: string) {
  if (!selectedOption) return false;
  const escaped = selectedOption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:先不公布答案|為什麼選\\s*[「『\"']?${escaped})`, "iu").test(teacherText)
    && !/(?:改選|修正|重新判斷|再比較|提示|答錯|不正確)/u.test(teacherText);
}

function preservesInitialChoice(reply: string, selectedOption: string) {
  if (!selectedOption) return true;
  const escaped = selectedOption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rejectsChoice = new RegExp(`(?:不選|不該選|改選|不是|並非|選錯|錯在選|${escaped}\\s*(?:不成立|錯誤|不正確)|(?:答案|正解)\\s*(?:是|為)\\s*(?!${escaped})[ABCD])`, "iu");
  if (rejectsChoice.test(reply)) return false;
  return new RegExp(`(?:我選|選擇|所以選|因此選)\\s*[「『\"']?${escaped}|${escaped}\\s*(?:成立|正確|有道理)`, "iu").test(reply);
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
      if (text && typeof text === "object" && typeof (text as { value?: unknown }).value === "string") {
        return (text as { value: string }).value;
      }
      return "";
    });
  }).join("").trim();
}

function readUsage(payload: unknown) {
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : null;
  const inputTokens = Number(usage?.input_tokens ?? 0);
  const outputTokens = Number(usage?.output_tokens ?? 0);
  const details = usage?.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : null;
  return { inputTokens, outputTokens, cachedTokens: Number(details?.cached_tokens ?? 0) };
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  let body: { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel; subject?: string; question?: string };
  try {
    body = await request.json() as { prompt?: string; responses?: TeacherResponse[]; level?: TeachingLevel; subject?: string; question?: string };
  } catch {
    return Response.json({ error: "接續回覆資料格式不正確" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim();
  const responses = (Array.isArray(body.responses) ? body.responses : [])
    .filter((response) => response && typeof response.text === "string" && response.text.trim() && !response.error)
    .slice(0, 3);
  if (!prompt || responses.length === 0) {
    return Response.json({ error: "請先完成目前選定模型的回答" }, { status: 400 });
  }

  const apiKey = await getOpenAIKey();
  if (!apiKey) return Response.json({ error: "AI 服務尚未設定" }, { status: 503 });
  const model = await getOpenAIModel("gpt-5.6-luna");
  const subject = String(body.subject ?? "綜合").trim() || "綜合";
  const question = String(body.question ?? "").trim();
  const subjectRule = subject.includes("公司") || subject.includes("商事")
    ? "這是公司法／商事法題目。只能使用公司機關、股東／董事身分、法律關係、權利義務、決議效力、規範與涵攝等語彙；不得把它寫成刑法案例，不得自行加入犯罪、故意、未遂或因果關係。"
    : subject.includes("刑法") && !subject.includes("刑事訴訟")
      ? "這是刑法題目，可以依題目內容討論行為、犯罪構成、故意、未遂、共犯與因果關係，但不得捏造題目沒有的事實。"
      : `這是${subject}題目，請依該科目的法律關係與規範回答，不要套用其他法科的固定模板。`;
  const teacherText = responses.map((response) => `${response.label || "老師"}（${response.model || ""}）：\n${String(response.text).slice(0, 6000)}`).join("\n\n");
  const selectedOption = selectedOptionFromContext(prompt, teacherText);
  const selectedOptionText = optionTextFromQuestion(question, selectedOption);
  const initialChoiceReasonRequest = isInitialChoiceReasonRequest(teacherText, selectedOption);
  const levelLabel = body.level === "beginner" ? "法律小白" : body.level === "intermediate" ? "基礎考生" : body.level === "advanced" ? "進階考生" : body.level === "super" ? "頂尖學霸" : "目前程度的學生";
  const levelRule = body.level === "beginner"
    ? "用白話直接回答；可以不會法律術語、誤解選項或判斷錯誤，但仍須指出選項實際在說什麼，不能用空泛套話代替理解。"
    : body.level === "intermediate"
      ? "先回答結論，再嘗試把一個法律要件套入本題事實；可以不完整，留給導師糾正。"
      : body.level === "advanced" || body.level === "super"
        ? "精準回答結論、決定性要件與題目事實的涵攝；只處理導師當輪所問，不自行擴張。"
        : "像一般學生一樣先直接回答判斷，再用題目中的一項具體事實說明理由。";
  const instructions = `你是正在測試司律 AI 導師的${levelLabel}學生，不是老師，也不是評審。這題的科目是${subject}。${subjectRule}請針對指定的那一則 AI 導師訊息，寫出一則自然、短小、可以直接放進對話框的「模擬學生回答」。

要求：
1. 找出 AI 導師在指定訊息中最後提出的當輪問題，第一句先直接回答「是／否、成立／不成立、同意／不同意」或相應的明確判斷，第二句再用題目事實說明理由。
2. ${levelRule}
3. 若當輪是在問「為什麼選 A／B／C／D」，必須先閱讀題目中的該選項，並在回答中用自己的話說出該選項的具體法律主張：至少包含「誰對誰主張什麼權利／應負什麼義務」或該選項的決定性法律概念，再連結一項題目事實。不得只說「符合題意」「符合關鍵文字」「法律關係合理」「處理方式正確」「依實際情況判斷」等可套用任何選項的空泛理由。
3-1. ${initialChoiceReasonRequest ? `本輪是學生第一次解釋自己為何選 ${selectedOption}。你必須鎖定並維護這個選擇，站在「${selectedOption} 是正確答案」的錯誤立場，生成一個與該選項內容相符、看似合理但可能法律上錯誤的學生理由。第一句必須說「我選 ${selectedOption}，因為……」。絕對不得說「不選 ${selectedOption}」、「${selectedOption} 不成立／錯誤」、改選其他選項或提前講出正解；即使你知道正確答案也不得自行糾正。` : "若導師已經指出原選項錯誤並提供提示，才可以明確說明原先哪裡想錯，並依提示改選；不得假裝自己一開始就知道正解。"}
4. 絕對不得反問 AI 導師，不得提出任何新問題，不得使用問號，也不得寫成「應如何認定」「是否可能」「我想請問」。
5. 不得加入指定訊息與題目沒有出現的事實、法條、判決或新爭點，也不要重述整段訊息。
6. 絕對不要輸出「【選取內容】」「追問給你」「處理要求」「請選邊站」或其他內部提示文字。
7. 程度不足時可以回答不完整或答錯，讓導師後續糾正；但仍須正面回答當輪問題，不能以「我不確定」代替作答。
8. 不要使用標題、條列、Markdown 或引號包住全文；使用繁體中文，約 40 至 140 字，直接輸出學生要說的內容。`;
  const baseInput = `題目科目：${subject}\n題目內容：${question.slice(0, 5000)}${selectedOptionText ? `\n\n本輪學生選的是 ${selectedOption}，該選項原文：${selectedOptionText}` : ""}\n\n學生指定的訊息：\n${teacherText}`;
  const startedAt = Date.now();
  let payload: Record<string, unknown> = {};
  let reply = "";
  let lastStatus = 0;

  // Reasoning models can consume a small token allowance before emitting any
  // visible text. Give the student answer enough room and retry once when the
  // provider returns a successful response without an answer body.
  for (const [attempt, maxOutputTokens] of [1600, 2000, 2400].entries()) {
    const input = attempt === 0
      ? baseInput
      : `${baseInput}\n\n上一版回答未通過檢查，已被系統退回。請重新回答，必須明確重述「${selectedOptionText}」中的至少一個決定性法律概念或關鍵用語。${initialChoiceReasonRequest ? `學生已經選 ${selectedOption}，你必須順著這個選擇提出支持 ${selectedOption} 的理由，即使該理由在法律上是錯的；不得否定 ${selectedOption}、不得改選、不得揭露正解。` : `請依導師本輪提示說明原先哪裡想錯或現在如何修正。`}不得使用「當事人間應依法律關係負擔權利義務」等萬用句。`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        instructions,
        input,
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
        max_output_tokens: maxOutputTokens,
      }),
    });
    lastStatus = response.status;
    payload = await response.json() as Record<string, unknown>;
    if (!response.ok) break;
    reply = extractText(payload);
    if (reply && concretelyAddressesOption(reply, selectedOptionText) && (!initialChoiceReasonRequest || preservesInitialChoice(reply, selectedOption))) break;
    reply = "";
  }

  if (!reply && lastStatus >= 400) {
    return Response.json({ error: "模擬學生目前無法連線，請再試一次" }, { status: 502 });
  }
  if (!reply) return Response.json({ error: "模擬學生尚未具體回應所選選項，請再試一次" }, { status: 502 });

  const usage = readUsage(payload);
  const estimatedCostUsd = (Math.max(0, usage.inputTokens - usage.cachedTokens) * 0.10 + usage.cachedTokens * 0.01 + usage.outputTokens * 0.60) / 1_000_000;
  try {
    const db = await getDb();
    await db.insert(usageLogs).values({
      model,
      source: body.level ? `程度學生接續回覆｜${levelLabel}` : "依老師回覆生成同學接續回覆",
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      fileSearchCalls: 0,
      estimatedCostUsdMicros: Math.round(estimatedCostUsd * 1_000_000),
    });
  } catch {
    // A logging failure must not discard the generated student reply.
  }
  return Response.json({ reply, model, usage: { ...usage, durationMs: Math.max(0, Date.now() - startedAt), estimatedCostUsd } });
}
