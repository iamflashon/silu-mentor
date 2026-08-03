import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";

function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.hostname === "youtu.be" || url.hostname === "www.youtube.com" || url.hostname === "youtube.com") && Boolean(url.searchParams.get("v") || url.pathname.startsWith("/embed/") || url.hostname === "youtu.be");
  } catch {
    return false;
  }
}

export async function GET() {
  const db = await getDb();
  const [setting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "focus_music_url")).limit(1);
  return Response.json({ focusMusicUrl: setting?.value ?? "" });
}

export async function PATCH(request: Request) {
  const body = await request.json() as { focusMusicUrl?: unknown };
  const value = typeof body.focusMusicUrl === "string" ? body.focusMusicUrl.trim() : "";
  if (value && !isYoutubeUrl(value)) return Response.json({ error: "請輸入有效的 YouTube 音樂網址" }, { status: 400 });
  const db = await getDb();
  await db.insert(appSettings).values({ key: "focus_music_url", value, updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return Response.json({ focusMusicUrl: value });
}
