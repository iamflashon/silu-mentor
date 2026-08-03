import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { savedNotes } from "../../../db/schema";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""; const db = await getDb();
    const owner = eq(savedNotes.userKey, userKey(request));
    const where = query ? and(owner, or(like(savedNotes.title, `%${query}%`), like(savedNotes.content, `%${query}%`), like(savedNotes.tags, `%${query}%`))) : owner;
    return Response.json({ notes: await db.select().from(savedNotes).where(where).orderBy(desc(savedNotes.updatedAt)).limit(100) });
  } catch { return Response.json({ error: "筆記暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceType?: string; sourceId?: string; title?: string; content?: string; subject?: string; tags?: string; sourceLabel?: string };
    const db = await getDb(); const [note] = await db.insert(savedNotes).values({ userKey: userKey(request), sourceType: body.sourceType?.trim() || "manual", sourceId: body.sourceId?.trim() || null, title: body.title?.trim() || "我的筆記", content: (body.content ?? "").trim(), subject: body.subject?.trim() || "綜合", tags: body.tags?.trim() || "", sourceLabel: body.sourceLabel?.trim() || "" }).returning();
    return Response.json({ note }, { status: 201 });
  } catch { return Response.json({ error: "無法收藏筆記" }, { status: 500 }); }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { id?: number; title?: string; content?: string; subject?: string; tags?: string }; const id = Number(body.id);
    if (!Number.isInteger(id)) return Response.json({ error: "筆記資料不完整" }, { status: 400 });
    const db = await getDb(); await db.update(savedNotes).set({ title: body.title?.trim() || "我的筆記", content: (body.content ?? "").trim(), subject: body.subject?.trim() || "綜合", tags: body.tags?.trim() || "", updatedAt: new Date() }).where(and(eq(savedNotes.id, id), eq(savedNotes.userKey, userKey(request))));
    return Response.json({ id });
  } catch { return Response.json({ error: "無法更新筆記" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  try { const id = Number(new URL(request.url).searchParams.get("id")); const db = await getDb(); await db.delete(savedNotes).where(and(eq(savedNotes.id, id), eq(savedNotes.userKey, userKey(request)))); return Response.json({ id }); }
  catch { return Response.json({ error: "無法刪除筆記" }, { status: 500 }); }
}
