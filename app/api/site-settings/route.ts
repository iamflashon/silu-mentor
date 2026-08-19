import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";

type ExamCountdown = { id: string; label: string; date: string; enabled: boolean };
type BattleAlert = { id: string; text: string; url: string; enabled: boolean };

function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.hostname === "youtu.be" || url.hostname === "www.youtube.com" || url.hostname === "youtube.com") && Boolean(url.searchParams.get("v") || url.pathname.startsWith("/embed/") || url.hostname === "youtu.be");
  } catch {
    return false;
  }
}

function parseJsonSetting<T>(value: string | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function validWebUrl(value: string) {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}

async function saveSetting(key: string, value: string) {
  const db = await getDb();
  await db.insert(appSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function GET() {
  const db = await getDb();
  const settings = await db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings);
  const values = Object.fromEntries(settings.map((item) => [item.key, item.value]));
  return Response.json({
    focusMusicUrl: values.focus_music_url ?? "",
    examCountdowns: parseJsonSetting<ExamCountdown[]>(values.exam_countdowns, []),
    battleAlerts: parseJsonSetting<BattleAlert[]>(values.battle_alerts, []),
    learningCenterEnabled: values.learning_center_enabled !== "false",
    homeWebSearchMode: ["off", "fallback", "always"].includes(values.home_web_search_mode) ? values.home_web_search_mode : "off",
  });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { focusMusicUrl?: unknown; examCountdowns?: unknown; battleAlerts?: unknown; learningCenterEnabled?: unknown; homeWebSearchMode?: unknown };
  const response: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "focusMusicUrl")) {
    const value = typeof body.focusMusicUrl === "string" ? body.focusMusicUrl.trim() : "";
    if (value && !isYoutubeUrl(value)) return Response.json({ error: "請輸入有效的 YouTube 音樂網址" }, { status: 400 });
    await saveSetting("focus_music_url", value);
    response.focusMusicUrl = value;
  }
  if (Object.prototype.hasOwnProperty.call(body, "examCountdowns")) {
    if (!Array.isArray(body.examCountdowns)) return Response.json({ error: "考試日期資料格式不正確" }, { status: 400 });
    const exams = body.examCountdowns.slice(0, 20).map((item, index) => {
      const row = item as Partial<ExamCountdown>;
      return { id: String(row.id || `exam-${Date.now()}-${index}`), label: String(row.label ?? "").trim().slice(0, 40), date: String(row.date ?? "").trim(), enabled: row.enabled !== false };
    }).filter((item) => item.label && /^\d{4}-\d{2}-\d{2}$/.test(item.date));
    await saveSetting("exam_countdowns", JSON.stringify(exams));
    response.examCountdowns = exams;
  }
  if (Object.prototype.hasOwnProperty.call(body, "battleAlerts")) {
    if (!Array.isArray(body.battleAlerts)) return Response.json({ error: "作戰快訊資料格式不正確" }, { status: 400 });
    const alerts = body.battleAlerts.slice(0, 30).map((item, index) => {
      const row = item as Partial<BattleAlert>;
      return { id: String(row.id || `alert-${Date.now()}-${index}`), text: String(row.text ?? "").trim().slice(0, 120), url: String(row.url ?? "").trim().slice(0, 500), enabled: row.enabled !== false };
    }).filter((item) => item.text);
    if (alerts.some((item) => !validWebUrl(item.url))) return Response.json({ error: "快訊連結必須是有效的 http 或 https 網址" }, { status: 400 });
    await saveSetting("battle_alerts", JSON.stringify(alerts));
    response.battleAlerts = alerts;
  }
  if (Object.prototype.hasOwnProperty.call(body, "learningCenterEnabled")) {
    const enabled = body.learningCenterEnabled !== false;
    await saveSetting("learning_center_enabled", String(enabled));
    response.learningCenterEnabled = enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, "homeWebSearchMode")) {
    const mode = String(body.homeWebSearchMode ?? "off");
    if (!["off", "fallback", "always"].includes(mode)) return Response.json({ error: "外網搜尋模式不正確" }, { status: 400 });
    await saveSetting("home_web_search_mode", mode);
    response.homeWebSearchMode = mode;
  }
  return Response.json(response);
}
