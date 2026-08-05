import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { noteAttachments, savedNotes } from "../../../db/schema";

function userKey(request: Request) { return request.headers.get("oai-authenticated-user-email") ?? "default-owner"; }

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""; const db = await getDb();
    const owner = eq(savedNotes.userKey, userKey(request));
    const where = query ? and(owner, or(like(savedNotes.title, `%${query}%`), like(savedNotes.content, `%${query}%`), like(savedNotes.tags, `%${query}%`))) : owner;
    const notes = await db.select().from(savedNotes).where(where).orderBy(desc(savedNotes.updatedAt)).limit(100);
    const attachments = notes.length
      ? await db.select().from(noteAttachments).where(inArray(noteAttachments.noteId, notes.map((note) => note.id)))
      : [];
    const attachmentsByNote = new Map<number, typeof attachments>();
    for (const attachment of attachments) attachmentsByNote.set(attachment.noteId, [...(attachmentsByNote.get(attachment.noteId) ?? []), attachment]);
    return Response.json({ notes: notes.map((note) => ({
      ...note,
      attachments: (attachmentsByNote.get(note.id) ?? []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        sourceUrl: attachment.sourceUrl,
        episodeTitle: attachment.episodeTitle,
        positionSeconds: attachment.positionSeconds,
        url: `/api/notes/attachment?id=${attachment.id}`,
      })),
    })) });
  } catch { return Response.json({ error: "筆記暫時無法讀取" }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceType?: string; sourceId?: string; title?: string; content?: string; subject?: string; tags?: string; sourceLabel?: string; imageDataUrl?: string; imageSourceUrl?: string; episodeTitle?: string; positionSeconds?: number };
    const image = parseImageDataUrl(body.imageDataUrl);
    if (body.imageDataUrl && !image) return Response.json({ error: "截圖格式不正確或檔案太大" }, { status: 400 });
    const owner = userKey(request);
    const db = await getDb();
    const [note] = await db.insert(savedNotes).values({ userKey: owner, sourceType: body.sourceType?.trim() || "manual", sourceId: body.sourceId?.trim() || null, title: body.title?.trim() || "我的筆記", content: (body.content ?? "").trim(), subject: body.subject?.trim() || "綜合", tags: body.tags?.trim() || "", sourceLabel: body.sourceLabel?.trim() || "" }).returning();
    if (image) {
      const storageKey = `notes/${crypto.randomUUID()}.jpg`;
      try {
        const { env } = await import("cloudflare:workers");
        await env.BUCKET.put(storageKey, image.bytes, { httpMetadata: { contentType: image.contentType } });
        await db.insert(noteAttachments).values({ noteId: note.id, userKey: owner, kind: "screenshot", storageKey, contentType: image.contentType, sizeBytes: image.bytes.byteLength, sourceUrl: String(body.imageSourceUrl ?? "").slice(0, 1000), episodeTitle: String(body.episodeTitle ?? "").slice(0, 300), positionSeconds: Math.max(0, Math.floor(Number(body.positionSeconds) || 0)) });
      } catch {
        await db.delete(savedNotes).where(and(eq(savedNotes.id, note.id), eq(savedNotes.userKey, owner)));
        return Response.json({ error: "截圖暫時無法保存，請稍後再試" }, { status: 503 });
      }
    }
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
  try {
    const id = Number(new URL(request.url).searchParams.get("id")); const owner = userKey(request); const db = await getDb();
    const attachments = await db.select({ storageKey: noteAttachments.storageKey }).from(noteAttachments).where(and(eq(noteAttachments.noteId, id), eq(noteAttachments.userKey, owner)));
    try {
      const { env } = await import("cloudflare:workers");
      for (const attachment of attachments) await env.BUCKET.delete(attachment.storageKey);
    } catch { /* the database deletion still removes the user's note */ }
    await db.delete(savedNotes).where(and(eq(savedNotes.id, id), eq(savedNotes.userKey, owner)));
    return Response.json({ id });
  }
  catch { return Response.json({ error: "無法刪除筆記" }, { status: 500 }); }
}

function parseImageDataUrl(value?: string) {
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  if (binary.length > 3 * 1024 * 1024) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { contentType: match[1], bytes };
}
