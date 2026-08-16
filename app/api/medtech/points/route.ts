import { eq } from "drizzle-orm";
import { members } from "../../../../db/schema";
import { addMedtechPoints } from "../../../../lib/medtech-usage";
import { requireMedtechAdmin } from "../../../../lib/member-auth";

export async function POST(request: Request) {
  const auth = await requireMedtechAdmin(request);
  if ("error" in auth) return auth.error;
  const body = await request.json() as { memberId?: number; amount?: number; note?: string };
  const memberId = Number(body.memberId);
  const amount = Number(body.amount);
  if (!Number.isInteger(memberId) || memberId < 1) return Response.json({ error: "缺少學員編號" }, { status: 400 });
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000) return Response.json({ error: "請輸入 1～10000 的加點數" }, { status: 400 });
  const [member] = await auth.db.select({ email: members.email }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) return Response.json({ error: "找不到學員帳號" }, { status: 404 });
  const description = body.note?.trim().slice(0, 120) || "管理員加點";
  const updated = await addMedtechPoints(auth.db, member.email, amount, description);
  if (!updated) return Response.json({ error: "加點失敗，請稍後再試" }, { status: 500 });
  return Response.json({ memberId, points: updated.aiCredits, added: amount, description });
}
