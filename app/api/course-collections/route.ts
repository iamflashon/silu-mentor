import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  courseCollectionItems,
  courseCollections,
  learningResources,
} from "../../../db/schema";

function clean(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

async function readCollections(includeDrafts: boolean) {
  const db = await getDb();
  const collections = await db
    .select()
    .from(courseCollections)
    .where(includeDrafts ? undefined : eq(courseCollections.status, "active"))
    .orderBy(asc(courseCollections.sortOrder), asc(courseCollections.id));

  if (!collections.length) return [];
  const items = await db
    .select({
      itemId: courseCollectionItems.id,
      collectionId: courseCollectionItems.collectionId,
      itemSortOrder: courseCollectionItems.sortOrder,
      resource: learningResources,
    })
    .from(courseCollectionItems)
    .innerJoin(
      learningResources,
      eq(courseCollectionItems.resourceId, learningResources.id),
    )
    .where(
      and(
        inArray(
          courseCollectionItems.collectionId,
          collections.map((collection) => collection.id),
        ),
        eq(learningResources.resourceType, "course"),
        ...(includeDrafts ? [] : [eq(learningResources.status, "active")]),
      ),
    )
    .orderBy(asc(courseCollectionItems.sortOrder), asc(courseCollectionItems.id));

  return collections.map((collection) => ({
    ...collection,
    courses: items
      .filter((item) => item.collectionId === collection.id)
      .map((item) => ({
        itemId: item.itemId,
        sortOrder: item.itemSortOrder,
        ...item.resource,
      })),
  }));
}

export async function GET(request: Request) {
  const includeDrafts = new URL(request.url).searchParams.get("all") === "1";
  return Response.json({ collections: await readCollections(includeDrafts) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const action = clean(body.action, "collection");
  const db = await getDb();

  if (action === "collection") {
    const title = clean(body.title);
    if (!title) return Response.json({ error: "請填寫專區名稱" }, { status: 400 });
    const [last] = await db
      .select({ sortOrder: courseCollections.sortOrder })
      .from(courseCollections)
      .orderBy(desc(courseCollections.sortOrder), desc(courseCollections.id))
      .limit(1);
    const [collection] = await db
      .insert(courseCollections)
      .values({
        title: title.slice(0, 120),
        description: clean(body.description).slice(0, 500),
        status: clean(body.status, "draft") === "active" ? "active" : "draft",
        sortOrder: (last?.sortOrder ?? -1) + 1,
      })
      .returning();
    return Response.json({ collection }, { status: 201 });
  }

  if (action === "item") {
    const collectionId = Number(body.collectionId);
    const resourceId = Number(body.resourceId);
    if (!collectionId || !resourceId)
      return Response.json({ error: "請選擇專區與影音課程" }, { status: 400 });
    const [collection] = await db
      .select({ id: courseCollections.id })
      .from(courseCollections)
      .where(eq(courseCollections.id, collectionId))
      .limit(1);
    const [resource] = await db
      .select({ id: learningResources.id, resourceType: learningResources.resourceType })
      .from(learningResources)
      .where(eq(learningResources.id, resourceId))
      .limit(1);
    if (!collection || !resource)
      return Response.json({ error: "找不到指定的專區或課程" }, { status: 404 });
    if (resource.resourceType !== "course")
      return Response.json({ error: "只有影音課程可以放入課程專區" }, { status: 422 });
    const [existing] = await db
      .select({ id: courseCollectionItems.id })
      .from(courseCollectionItems)
      .where(
        and(
          eq(courseCollectionItems.collectionId, collectionId),
          eq(courseCollectionItems.resourceId, resourceId),
        ),
      )
      .limit(1);
    if (existing)
      return Response.json({ error: "這堂課已經在此專區內" }, { status: 409 });
    const [last] = await db
      .select({ sortOrder: courseCollectionItems.sortOrder })
      .from(courseCollectionItems)
      .where(eq(courseCollectionItems.collectionId, collectionId))
      .orderBy(desc(courseCollectionItems.sortOrder), desc(courseCollectionItems.id))
      .limit(1);
    const [item] = await db
      .insert(courseCollectionItems)
      .values({ collectionId, resourceId, sortOrder: (last?.sortOrder ?? -1) + 1 })
      .returning();
    return Response.json({ item }, { status: 201 });
  }

  return Response.json({ error: "不支援的課程專區操作" }, { status: 400 });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const entity = clean(body.entity, "collection");
  const id = Number(body.id);
  if (!id) return Response.json({ error: "缺少資料編號" }, { status: 400 });
  const db = await getDb();

  if (entity === "collection") {
    const title = clean(body.title);
    if (!title) return Response.json({ error: "請填寫專區名稱" }, { status: 400 });
    const [collection] = await db
      .update(courseCollections)
      .set({
        title: title.slice(0, 120),
        description: clean(body.description).slice(0, 500),
        status: clean(body.status, "draft") === "active" ? "active" : "draft",
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.max(0, Math.floor(Number(body.sortOrder))) : 0,
        updatedAt: new Date(),
      })
      .where(eq(courseCollections.id, id))
      .returning();
    return collection
      ? Response.json({ collection })
      : Response.json({ error: "找不到課程專區" }, { status: 404 });
  }

  const [item] = await db
    .update(courseCollectionItems)
    .set({
      sortOrder: Math.max(0, Math.floor(Number(body.sortOrder) || 0)),
      updatedAt: new Date(),
    })
    .where(eq(courseCollectionItems.id, id))
    .returning();
  return item
    ? Response.json({ item })
    : Response.json({ error: "找不到專區內課程" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const collectionId = Number(url.searchParams.get("collectionId"));
  const itemId = Number(url.searchParams.get("itemId"));
  if (!collectionId && !itemId)
    return Response.json({ error: "缺少要移除的資料" }, { status: 400 });
  const db = await getDb();
  if (collectionId) {
    await db.delete(courseCollections).where(eq(courseCollections.id, collectionId));
  } else {
    await db.delete(courseCollectionItems).where(eq(courseCollectionItems.id, itemId));
  }
  return Response.json({ ok: true });
}
