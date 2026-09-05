import { desc, eq } from "drizzle-orm";
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
  const body = await request.json() as { id?: number; action?: "publish" | "unpublish" };
  const id = Number(body.id || 0);
  if (!id || !body.action) return Response.json({ error: "缺少成果或操作。" }, { status: 400 });
  const reviewStatus = body.action === "publish" ? "published" : "pending_review";
  const [row] = await auth.db.update(pengliStudyArtifacts)
    .set({ reviewStatus, updatedAt: new Date() })
    .where(eq(pengliStudyArtifacts.id, id)).returning();
  if (!row) return Response.json({ error: "找不到這筆學習成果。" }, { status: 404 });
  return Response.json({ row });
}
