import { getDb } from "../../../db";
import { usageLogs } from "../../../db/schema";
import { getOpenAIKey, getOpenAIModel, openAIJson } from "../../../lib/openai";
import { taipeiDate } from "../../../lib/taipei-time";

const zodiacNames = new Set(["牡羊座", "金牛座", "雙子座", "巨蟹座", "獅子座", "處女座", "天秤座", "天蠍座", "射手座", "摩羯座", "水瓶座", "雙魚座"]);
const weatherLabels: Record<number, string> = {
  0: "晴朗",
  1: "大致晴朗",
  2: "局部多雲",
  3: "多雲",
  45: "有霧",
  48: "霧凇",
  51: "毛毛雨",
  53: "小雨",
  55: "細雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  80: "短暫陣雨",
  81: "陣雨",
  82: "強陣雨",
  95: "雷雨",
  96: "雷雨伴冰雹",
  99: "強雷雨伴冰雹",
};

function todayTaipei() {
  return taipeiDate();
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown[] }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "");
  }).join("").trim();
}

function fallbackLuck(zodiac: string, subject: string) {
  const seed = [...`${todayTaipei()}${zodiac}${subject}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const score = 72 + seed % 19;
  return {
    score,
    headline: `${subject}適合穩定累積，不適合一次衝完全部。`,
    analysis: `${zodiac || "今天的你"}今天的考試運試重點在「先回想、再核對」。先做一小題或口頭說出構成要件，再回教材補漏洞，會比被動重讀更容易留下記憶。`,
    action: "先完成今日第一個任務，再做 10 分鐘錯題回想。",
    focus: "回想與涵攝",
    model: "fallback",
  };
}

async function getAiLuck(zodiac: string, subject: string, progress: string) {
  if (!(await getOpenAIKey())) return fallbackLuck(zodiac, subject);
  const model = await getOpenAIModel("gpt-5.6-luna");
  const payload = await openAIJson("/responses", {
    method: "POST",
    body: JSON.stringify({
      model,
      instructions: "你是台灣律師與司法官考試的 AI 導師。請把星座每日內容轉成有趣但不迷信的『運試』，只談今天如何更有效準備司律考試。不得預言考試結果，不得用空泛吉凶，不得捏造法律內容。回覆繁體中文、短句、可執行。",
      input: [{ role: "user", content: [{ type: "input_text", text: `台北日期：${todayTaipei()}\n星座：${zodiac || "未指定"}\n今天主科：${subject}\n學習狀態：${progress}\n請給一份今日考試運試分析。` }] }],
      text: {
        format: {
          type: "json_schema",
          name: "exam_luck",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: { type: "integer", minimum: 1, maximum: 100 },
              headline: { type: "string" },
              analysis: { type: "string" },
              action: { type: "string" },
              focus: { type: "string" },
            },
            required: ["score", "headline", "analysis", "action", "focus"],
          },
        },
      },
    }),
  });
  const parsed = JSON.parse(outputText(payload)) as { score: number; headline: string; analysis: string; action: string; focus: string };
  const usage = payload && typeof payload === "object" ? (payload as { usage?: Record<string, unknown> }).usage : undefined;
  try {
    const db = await getDb();
    await db.insert(usageLogs).values({
      model: String(payload.model ?? model),
      source: "今日運試",
      inputTokens: Number(usage?.input_tokens ?? 0),
      cachedTokens: Number((usage?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? 0),
      outputTokens: Number(usage?.output_tokens ?? 0),
      fileSearchCalls: 0,
      estimatedCostUsdMicros: 0,
    });
  } catch { /* 運試不能因成本紀錄失敗而中斷 */ }
  return { ...parsed, model: String(payload.model ?? model) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const zodiac = zodiacNames.has(url.searchParams.get("zodiac") ?? "") ? url.searchParams.get("zodiac")! : "";
  const subject = String(url.searchParams.get("subject") ?? "刑法").slice(0, 30);
  const progress = String(url.searchParams.get("progress") ?? "先完成今日第一項任務").slice(0, 160);
  let weather = { location: "台北市", temperature: null as number | null, apparentTemperature: null as number | null, label: "天氣資料暫時無法取得", rainProbability: null as number | null };
  try {
    const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=25.0330&longitude=121.5654&current=temperature_2m,apparent_temperature,weather_code&hourly=precipitation_probability&forecast_days=1&timezone=Asia%2FTaipei");
    if (response.ok) {
      const data = await response.json() as { current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number }; hourly?: { precipitation_probability?: number[] } };
      weather = {
        location: "台北市",
        temperature: data.current?.temperature_2m ?? null,
        apparentTemperature: data.current?.apparent_temperature ?? null,
        label: weatherLabels[data.current?.weather_code ?? -1] ?? "天氣變化中",
        rainProbability: data.hourly?.precipitation_probability?.[new Date().getHours()] ?? null,
      };
    }
  } catch { /* 保留可用的運試內容 */ }
  let luck;
  try {
    luck = await getAiLuck(zodiac, subject, progress);
  } catch {
    luck = fallbackLuck(zodiac, subject);
  }
  return Response.json({ today: todayTaipei(), weather, luck });
}
