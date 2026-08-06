import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { studyRecords } from "../../../db/schema";
import { taipeiDate } from "../../../lib/taipei-time";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }
function today() { return taipeiDate(); }

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const rows = await db.select().from(studyRecords).where(eq(studyRecords.userKey, userKey(request))).orderBy(desc(studyRecords.createdAt)).limit(100);
    return Response.json({ records: rows });
  } catch { return Response.json({ error: "學習紀錄暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { recordDate?: string; subject?: string; title?: string; activityType?: string; plannedMinutes?: number; actualMinutes?: number; reflection?: string; weakness?: string; nextStep?: string };
    if (!body.title?.trim()) return Response.json({ error: "請填寫學習內容" }, { status: 400 });
    const db = await getDb();
    const [record] = await db.insert(studyRecords).values({ userKey: userKey(request), recordDate: /^\d{4}-\d{2}-\d{2}$/.test(body.recordDate ?? "") ? body.recordDate! : today(), subject: body.subject?.trim() || "綜合", title: body.title.trim(), activityType: body.activityType?.trim() || "自修", plannedMinutes: Math.max(0, Number(body.plannedMinutes) || 0), actualMinutes: Math.max(0, Math.min(720, Number(body.actualMinutes) || 0)), reflection: body.reflection?.trim() ?? "", weakness: body.weakness?.trim() ?? "", nextStep: body.nextStep?.trim() ?? "" }).returning();
    return Response.json({ record }, { status: 201 });
  } catch { return Response.json({ error: "無法新增學習紀錄" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { id?: number; actualMinutes?: number; reflection?: string; weakness?: string; nextStep?: string };
    const id = Number(body.id); if (!Number.isInteger(id) || id < 1) return Response.json({ error: "紀錄編號不正確" }, { status: 400 });
    const db = await getDb();
    await db.update(studyRecords).set({ actualMinutes: Math.max(0, Math.min(720, Number(body.actualMinutes) || 0)), reflection: body.reflection?.trim() ?? "", weakness: body.weakness?.trim() ?? "", nextStep: body.nextStep?.trim() ?? "" }).where(and(eq(studyRecords.id, id), eq(studyRecords.userKey, userKey(request))));
    return Response.json({ id });
  } catch { return Response.json({ error: "無法更新學習紀錄" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
      : [];
    if (!ids.length) return Response.json({ error: "請先選擇要刪除的學習紀錄" }, { status: 400 });

    const db = await getDb();
    await db.delete(studyRecords).where(and(
      eq(studyRecords.userKey, userKey(request)),
      inArray(studyRecords.id, ids),
    ));
    return Response.json({ deleted: ids.length });
  } catch {
    return Response.json({ error: "學習紀錄刪除失敗" }, { status: 500 });
  }
}
