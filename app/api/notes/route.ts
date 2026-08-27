import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  not,
  or,
} from "drizzle-orm";
import { getDb } from "../../../db";
import { noteAttachments, savedNotes } from "../../../db/schema";
import { requireMedtechMember } from "../../../lib/member-auth";

const MEDTECH_NOTE_FREE_LIMIT = 5;

function userKey(request: Request) {
  return request.headers.get("oai-authenticated-user-email") ?? "default-owner";
}

type NoteCategory = "law" | "pengli" | "medtech" | "accounting" | "data-structure";

function noteCategory(value: string | null | undefined): NoteCategory {
  return value === "pengli" ||
    value === "medtech" ||
    value === "accounting" ||
    value === "data-structure"
    ? value
    : "law";
}

function categoryFilter(category: NoteCategory) {
  if (category === "pengli")
    return or(
      like(savedNotes.sourceId, "pengli-%"),
      like(savedNotes.subject, "%彭狸老師%"),
      like(savedNotes.tags, "%彭狸老師%"),
      like(savedNotes.sourceLabel, "%彭狸老師%"),
      like(savedNotes.sourceLabel, "%行政法考點演習書%"),
    );
  if (category === "medtech")
    return or(
      like(savedNotes.sourceId, "medtech-selection-%"),
      like(savedNotes.subject, "醫檢師%"),
      like(savedNotes.tags, "%醫檢師%"),
    );
  if (category === "accounting")
    return or(
      eq(savedNotes.subject, "中級會計學"),
      eq(savedNotes.subject, "中級會計"),
      like(savedNotes.tags, "%中級會計%"),
      like(savedNotes.tags, "%中會%"),
      like(savedNotes.sourceId, "accounting-%"),
    );
  if (category === "data-structure")
    return or(
      eq(savedNotes.subject, "資料結構"),
      like(savedNotes.tags, "%資料結構%"),
      like(savedNotes.sourceId, "data-structure-%"),
    );
  return and(
    not(
      or(
        like(savedNotes.sourceId, "pengli-%"),
        like(savedNotes.subject, "%彭狸老師%"),
        like(savedNotes.tags, "%彭狸老師%"),
        like(savedNotes.sourceLabel, "%彭狸老師%"),
        like(savedNotes.sourceLabel, "%行政法考點演習書%"),
      ),
    ),
    not(
      or(
        like(savedNotes.subject, "醫檢師%"),
        like(savedNotes.tags, "%醫檢師%"),
      ),
    ),
    or(
      isNull(savedNotes.sourceId),
      not(like(savedNotes.sourceId, "medtech-%")),
    ),
    not(
      or(
        eq(savedNotes.subject, "中級會計學"),
        eq(savedNotes.subject, "中級會計"),
        like(savedNotes.tags, "%中級會計%"),
        like(savedNotes.tags, "%中會%"),
      ),
    ),
    or(
      isNull(savedNotes.sourceId),
      not(like(savedNotes.sourceId, "accounting-%")),
    ),
    not(
      or(
        eq(savedNotes.subject, "資料結構"),
        like(savedNotes.tags, "%資料結構%"),
      ),
    ),
    or(
      isNull(savedNotes.sourceId),
      not(like(savedNotes.sourceId, "data-structure-%")),
    ),
  );
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const category = noteCategory(params.get("category")?.trim());
    const db = await getDb();
    const owner = eq(savedNotes.userKey, userKey(request));
    const scopedCategory = categoryFilter(category);
    const queryFilter = query
      ? or(
          like(savedNotes.title, `%${query}%`),
          like(savedNotes.content, `%${query}%`),
          like(savedNotes.tags, `%${query}%`),
        )
      : undefined;
    const where = queryFilter
      ? and(owner, scopedCategory, queryFilter)
      : and(owner, scopedCategory);
    const [{ total }] = await db
      .select({ total: count() })
      .from(savedNotes)
      .where(where);
    const notes = await db
      .select()
      .from(savedNotes)
      .where(where)
      .orderBy(desc(savedNotes.updatedAt))
      .limit(100);
    const attachments = notes.length
      ? await db
          .select()
          .from(noteAttachments)
          .where(
            inArray(
              noteAttachments.noteId,
              notes.map((note) => note.id),
            ),
          )
      : [];
    const attachmentsByNote = new Map<number, typeof attachments>();
    for (const attachment of attachments)
      attachmentsByNote.set(attachment.noteId, [
        ...(attachmentsByNote.get(attachment.noteId) ?? []),
        attachment,
      ]);
    return Response.json({
      noteCount: Number(total ?? 0),
      freeNoteLimit: MEDTECH_NOTE_FREE_LIMIT,
      notes: notes.map((note) => ({
        ...note,
        attachments: (attachmentsByNote.get(note.id) ?? []).map(
          (attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            contentType: attachment.contentType,
            sizeBytes: attachment.sizeBytes,
            sourceUrl: attachment.sourceUrl,
            episodeTitle: attachment.episodeTitle,
            positionSeconds: attachment.positionSeconds,
            url: `/api/notes/attachment?id=${attachment.id}`,
          }),
        ),
      })),
    });
  } catch {
    return Response.json({ error: "筆記暫時無法讀取" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sourceType?: string;
      sourceId?: string;
      title?: string;
      content?: string;
      originalContent?: string;
      subject?: string;
      tags?: string;
      sourceLabel?: string;
      imageDataUrl?: string;
      imageSourceUrl?: string;
      episodeTitle?: string;
      positionSeconds?: number;
    };
    const image = parseImageDataUrl(body.imageDataUrl);
    if (body.imageDataUrl && !image)
      return Response.json(
        { error: "截圖格式不正確或檔案太大" },
        { status: 400 },
      );
    const isMedtechNote = [
      body.sourceId,
      body.subject,
      body.tags,
      body.sourceLabel,
    ].some(
      (value) =>
        typeof value === "string" &&
        (/^medtech-/u.test(value) || value.includes("醫檢師")),
    );
    const medtechAuth = isMedtechNote
      ? await requireMedtechMember(request)
      : null;
    if (medtechAuth && "error" in medtechAuth) return medtechAuth.error;
    const medtechMember =
      medtechAuth && !("error" in medtechAuth) ? medtechAuth : null;
    const owner = medtechMember?.userKey ?? userKey(request);
    const db = medtechMember?.db ?? (await getDb());
    const sourceId = body.sourceId?.trim() || null;
    if (sourceId) {
      const [existing] = await db
        .select()
        .from(savedNotes)
        .where(
          and(eq(savedNotes.userKey, owner), eq(savedNotes.sourceId, sourceId)),
        )
        .limit(1);
      if (existing) {
        if ((body.sourceType?.trim() || "manual") === "note") {
          await db
            .update(savedNotes)
            .set({
              sourceType: "note",
              title: body.title?.trim() || existing.title,
              content: (body.content ?? "").trim() || existing.content,
              originalContent: (
                body.originalContent ??
                existing.originalContent ??
                existing.content
              ).trim(),
              subject: body.subject?.trim() || existing.subject,
              tags: body.tags?.trim() || existing.tags,
              sourceLabel: body.sourceLabel?.trim() || existing.sourceLabel,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(savedNotes.id, existing.id),
                eq(savedNotes.userKey, owner),
              ),
            );
        }
        return Response.json(
          {
            note: {
              ...existing,
              sourceType:
                body.sourceType === "note" ? "note" : existing.sourceType,
            },
            merged: true,
          },
          { status: 200 },
        );
      }
    }

    const [note] = await db
      .insert(savedNotes)
      .values({
        userKey: owner,
        sourceType: body.sourceType?.trim() || "manual",
        sourceId,
        title: body.title?.trim() || "我的筆記",
        content: (body.content ?? "").trim(),
        originalContent: (body.originalContent ?? "").trim(),
        subject: body.subject?.trim() || "綜合",
        tags: body.tags?.trim() || "",
        sourceLabel: body.sourceLabel?.trim() || "",
      })
      .returning();
    if (image) {
      const storageKey = `notes/${crypto.randomUUID()}.jpg`;
      try {
        const { env } = await import("cloudflare:workers");
        await env.BUCKET.put(storageKey, image.bytes, {
          httpMetadata: { contentType: image.contentType },
        });
        await db
          .insert(noteAttachments)
          .values({
            noteId: note.id,
            userKey: owner,
            kind: "screenshot",
            storageKey,
            contentType: image.contentType,
            sizeBytes: image.bytes.byteLength,
            sourceUrl: String(body.imageSourceUrl ?? "").slice(0, 1000),
            episodeTitle: String(body.episodeTitle ?? "").slice(0, 300),
            positionSeconds: Math.max(
              0,
              Math.floor(Number(body.positionSeconds) || 0),
            ),
          });
      } catch {
        await db
          .delete(savedNotes)
          .where(
            and(eq(savedNotes.id, note.id), eq(savedNotes.userKey, owner)),
          );
        return Response.json(
          { error: "截圖暫時無法保存，請稍後再試" },
          { status: 503 },
        );
      }
    }
    return Response.json({ note, creditCost: 0 }, { status: 201 });
  } catch {
    return Response.json({ error: "無法收藏筆記" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: number;
      title?: string;
      content?: string;
      subject?: string;
      tags?: string;
      category?: string;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id))
      return Response.json({ error: "筆記資料不完整" }, { status: 400 });
    const db = await getDb();
    await db
      .update(savedNotes)
      .set({
        title: body.title?.trim() || "我的筆記",
        content: (body.content ?? "").trim(),
        subject: body.subject?.trim() || "綜合",
        tags: body.tags?.trim() || "",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(savedNotes.id, id),
          eq(savedNotes.userKey, userKey(request)),
          categoryFilter(noteCategory(body.category)),
        ),
      );
    return Response.json({ id });
  } catch {
    return Response.json({ error: "無法更新筆記" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    let ids: number[] = [];
    let requestedCategory = noteCategory(url.searchParams.get("category"));
    const singleId = Number(url.searchParams.get("id"));
    if (Number.isInteger(singleId) && singleId > 0) ids = [singleId];
    else {
      const body = (await request.json().catch(() => ({}))) as {
        ids?: unknown[];
        category?: string;
      };
      ids = [
        ...new Set(
          (body.ids ?? [])
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      requestedCategory = noteCategory(body.category);
    }
    if (!ids.length)
      return Response.json({ error: "請先選擇要刪除的筆記" }, { status: 400 });
    if (ids.length > 100)
      return Response.json(
        { error: "一次最多刪除 100 則筆記" },
        { status: 400 },
      );
    const owner = userKey(request);
    const db = await getDb();
    const owned = await db
      .select({ id: savedNotes.id })
      .from(savedNotes)
      .where(
        and(
          eq(savedNotes.userKey, owner),
          inArray(savedNotes.id, ids),
          categoryFilter(requestedCategory),
        ),
      );
    const ownedIds = owned.map((note) => note.id);
    if (!ownedIds.length)
      return Response.json({ error: "找不到可刪除的筆記" }, { status: 404 });
    const attachments = await db
      .select({ storageKey: noteAttachments.storageKey })
      .from(noteAttachments)
      .where(
        and(
          inArray(noteAttachments.noteId, ownedIds),
          eq(noteAttachments.userKey, owner),
        ),
      );
    try {
      const { env } = await import("cloudflare:workers");
      for (const attachment of attachments)
        await env.BUCKET.delete(attachment.storageKey);
    } catch {
      /* the database deletion still removes the user's note */
    }
    await db
      .delete(savedNotes)
      .where(
        and(eq(savedNotes.userKey, owner), inArray(savedNotes.id, ownedIds)),
      );
    return Response.json({
      id: ownedIds.length === 1 ? ownedIds[0] : undefined,
      ids: ownedIds,
      deleted: ownedIds.length,
    });
  } catch {
    return Response.json({ error: "無法刪除筆記" }, { status: 500 });
  }
}

function parseImageDataUrl(value?: string) {
  if (!value) return null;
  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
  );
  if (!match) return null;
  const binary = atob(match[2]);
  if (binary.length > 3 * 1024 * 1024) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { contentType: match[1], bytes };
}
