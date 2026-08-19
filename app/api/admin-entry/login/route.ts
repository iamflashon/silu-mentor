import { createAdminEntryCookie, isAdminCredentials, safeReturnTo } from "../../../../lib/admin-entry-auth";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; returnTo?: unknown } = {};
  try { body = await request.json(); } catch { /* handled as an invalid login below */ }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const cookie = email && password ? await isAdminCredentials(email, password) ? await createAdminEntryCookie() : "" : "";
  if (!cookie) return Response.json({ error: "管理員密碼錯誤，或尚未完成伺服器設定。" }, { status: 401 });
  return Response.json({ ok: true, returnTo: safeReturnTo(body.returnTo) }, {
    headers: { "cache-control": "no-store", "set-cookie": cookie },
  });
}
