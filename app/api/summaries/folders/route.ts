import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { studentSummaryOwnerKey } from "../../../../lib/student-summary";

type SummaryFolder = { subject: string; name: string };

function settingKey(request: Request) {
  return `student-summary-folders:${studentSummaryOwnerKey(request)}`;
}

function cleanFolders(value: unknown): SummaryFolder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const subject = String(row.subject ?? "綜合").trim().slice(0, 40) || "綜合";
    const name = String(row.name ?? "").trim().slice(0, 80);
    const key = `${subject}\u0000${name}`;
    if (!name || seen.has(key)) return [];
    seen.add(key);
    return [{ subject, name }];
  }).slice(0, 100);
}

export async function GET(request: Request) {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, settingKey(request))).limit(1);
  try {
    return Response.json({ folders: cleanFolders(JSON.parse(row?.value ?? "[]")) });
  } catch {
    return Response.json({ folders: [] });
  }
}

export async function PUT(request: Request) {
  const body = await request.json() as { folders?: unknown };
  const folders = cleanFolders(body.folders);
  const db = await getDb();
  await db.insert(appSettings).values({ key: settingKey(request), value: JSON.stringify(folders), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(folders), updatedAt: new Date() } });
  return Response.json({ folders });
}
