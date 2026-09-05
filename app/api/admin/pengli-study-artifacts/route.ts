import { desc, eq, inArray } from "drizzle-orm";
import { pengliStudyArtifacts } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/member-auth";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const rows = await auth.db.select().from(pengliStudyArtifacts)
    .orderBy(desc(pengliStudyArtifacts.updatedAt)).limit(200);
  return Response.json({ rows });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { id?: number; ids?: number[]; action?: "publish" | "unpublish" | "edit"; content?: string; sourceLabel?: string };
  const ids = normalizeIds(body.ids || (body.id ? [body.id] : []));
  if (!ids.length || !body.action) return Response.json({ error: "缺少成果或操作。" }, { status: 400 });
  if (body.action === "edit") {
    if (ids.length !== 1 || !body.content?.trim()) return Response.json({ error: "請提供一筆成果及完整內容。" }, { status: 400 });
    const [row] = await auth.db.update(pengliStudyArtifacts)
      .set({ content: body.content.trim(), sourceLabel: body.sourceLabel?.trim() || "教材內容", updatedAt: new Date() })
      .where(eq(pengliStudyArtifacts.id, ids[0])).returning();
    if (!row) return Response.json({ error: "找不到這筆學習成果。" }, { status: 404 });
    return Response.json({ row, updatedCount: 1 });
  }
  const reviewStatus = body.action === "publish" ? "published" : "pending_review";
  const rows = await auth.db.update(pengliStudyArtifacts)
    .set({ reviewStatus, updatedAt: new Date() })
    .where(inArray(pengliStudyArtifacts.id, ids)).returning();
  if (!rows.length) return Response.json({ error: "找不到所選學習成果。" }, { status: 404 });
  return Response.json({ rows, updatedCount: rows.length });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { ids?: number[] };
  const ids = normalizeIds(body.ids || []);
  if (!ids.length) return Response.json({ error: "請先選擇要刪除的成果。" }, { status: 400 });
  const rows = await auth.db.delete(pengliStudyArtifacts).where(inArray(pengliStudyArtifacts.id, ids)).returning({ id: pengliStudyArtifacts.id });
  return Response.json({ deletedCount: rows.length });
}

function normalizeIds(values: number[]) {
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 200);
}
