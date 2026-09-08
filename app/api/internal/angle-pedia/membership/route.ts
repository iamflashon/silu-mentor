import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { memberExamAccess, members } from "../../../../../db/schema";

type MembershipEnv = {
  ANGLE_PEDIA_MEMBERSHIP_SHARED_SECRET?: string;
};

async function configuredSecret() {
  const runtime = await import("cloudflare:workers") as { env?: MembershipEnv };
  return (runtime.env?.ANGLE_PEDIA_MEMBERSHIP_SHARED_SECRET
    ?? process.env.ANGLE_PEDIA_MEMBERSHIP_SHARED_SECRET
    ?? "").trim();
}

async function sameSecret(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function POST(request: Request) {
  const expectedSecret = await configuredSecret();
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "").trim() ?? "";
  if (!expectedSecret || !suppliedSecret || !(await sameSecret(suppliedSecret, expectedSecret))) {
    return Response.json({ error: "未授權" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return Response.json({ error: "Email 格式不正確" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const db = await getDb();
  const [row] = await db
    .select({
      displayName: members.displayName,
      role: members.role,
      memberStatus: members.status,
      className: members.className,
      accessStatus: memberExamAccess.status,
      canAdmin: memberExamAccess.canAdmin,
    })
    .from(members)
    .leftJoin(
      memberExamAccess,
      and(eq(memberExamAccess.memberId, members.id), eq(memberExamAccess.examCategory, "angle-pedia")),
    )
    .where(eq(members.email, email))
    .limit(1);

  const authorized = Boolean(row && row.memberStatus === "active" && row.accessStatus === "active");
  return Response.json({
    authorized,
    member: authorized ? {
      email,
      displayName: row?.displayName || email,
      role: row?.role === "teacher" ? "teacher" : "student",
      canAdmin: Boolean(row?.canAdmin),
      className: row?.className || "未分班",
    } : null,
  }, { headers: { "cache-control": "no-store" } });
}
