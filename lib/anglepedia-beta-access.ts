import { env } from "cloudflare:workers";
import { authenticatedEmail } from "./member-auth";

const ANGLEPEDIA_CATEGORY = "angle-pedia";
const ANGLEPEDIA_BETA_LIMIT = 10;

type AnglePediaBetaStatus = "anonymous" | "active" | "pending" | "paused";

export async function ensureAnglePediaBetaAccess(request: Request): Promise<{ status: AnglePediaBetaStatus }> {
  const email = authenticatedEmail(request);
  if (!email) return { status: "anonymous" };

  const db = (env as unknown as { DB: D1Database }).DB;
  const displayName = email.split("@")[0] || email;
  let member = await db.prepare("SELECT id,status,can_admin AS canAdmin FROM members WHERE lower(email)=? LIMIT 1")
    .bind(email)
    .first<{ id: number; status: string; canAdmin: number }>();

  if (!member) {
    await db.prepare(`INSERT INTO members (email,password_hash,display_name,role,can_admin,status,class_name,created_at,updated_at)
      VALUES (?,?,?,'student',0,'active','AnglePedia 網站測試',unixepoch(),unixepoch())
      ON CONFLICT(email) DO NOTHING`)
      .bind(email, `chatgpt$${crypto.randomUUID()}${crypto.randomUUID()}`, displayName)
      .run();
    member = await db.prepare("SELECT id,status,can_admin AS canAdmin FROM members WHERE lower(email)=? LIMIT 1")
      .bind(email)
      .first<{ id: number; status: string; canAdmin: number }>();
  }

  if (!member || member.status !== "active") return { status: "paused" };
  await db.prepare("UPDATE members SET last_seen_at=unixepoch(),updated_at=unixepoch() WHERE id=?")
    .bind(member.id)
    .run();
  if (member.canAdmin) return { status: "active" };

  let access = await db.prepare("SELECT status FROM member_exam_access WHERE member_id=? AND exam_category=? LIMIT 1")
    .bind(member.id, ANGLEPEDIA_CATEGORY)
    .first<{ status: string }>();

  if (!access) {
    await db.prepare(`INSERT INTO member_exam_access
      (member_id,exam_category,status,can_admin,permissions_json,allowed_document_ids_json,class_name,created_at,updated_at)
      SELECT ?,'angle-pedia','active',0,'[]','[]','AnglePedia 首批 10 名',unixepoch(),unixepoch()
      WHERE (SELECT COUNT(*) FROM member_exam_access WHERE exam_category='angle-pedia' AND status='active') < ?
      ON CONFLICT(member_id,exam_category) DO NOTHING`)
      .bind(member.id, ANGLEPEDIA_BETA_LIMIT)
      .run();
    access = await db.prepare("SELECT status FROM member_exam_access WHERE member_id=? AND exam_category=? LIMIT 1")
      .bind(member.id, ANGLEPEDIA_CATEGORY)
      .first<{ status: string }>();
  }

  if (!access) {
    await db.prepare(`INSERT INTO member_exam_access
      (member_id,exam_category,status,can_admin,permissions_json,allowed_document_ids_json,class_name,created_at,updated_at)
      VALUES (?,'angle-pedia','pending',0,'[]','[]','AnglePedia 候補申請',unixepoch(),unixepoch())
      ON CONFLICT(member_id,exam_category) DO NOTHING`)
      .bind(member.id)
      .run();
    access = await db.prepare("SELECT status FROM member_exam_access WHERE member_id=? AND exam_category=? LIMIT 1")
      .bind(member.id, ANGLEPEDIA_CATEGORY)
      .first<{ status: string }>();
  }

  return {
    status: access?.status === "active" ? "active" : access?.status === "pending" ? "pending" : "paused",
  };
}
