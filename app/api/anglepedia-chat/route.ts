import { ensureAnglePediaBetaAccess } from "../../../lib/anglepedia-beta-access";
import { POST as chatPost } from "../chat/route";

export async function POST(request: Request) {
  const access = await ensureAnglePediaBetaAccess(request);
  if (access.status === "anonymous") {
    return Response.json({
      error: "請先使用 ChatGPT 帳號登入，再開始 AnglePedia 測試。",
      code: "SIGN_IN_REQUIRED",
      signIn: "/signin-with-chatgpt?return_to=%2Fanglepedia",
    }, { status: 401 });
  }
  if (access.status === "pending") {
    return Response.json({
      error: "AnglePedia 首批 10 名測試名額已滿，我們已替你登記申請，請等待管理員開通。",
      code: "ANGLEPEDIA_BETA_PENDING",
    }, { status: 403 });
  }
  if (access.status === "paused") {
    return Response.json({
      error: "這個 AnglePedia 測試帳號目前尚未開通，請聯絡管理員。",
      code: "ANGLEPEDIA_BETA_PAUSED",
    }, { status: 403 });
  }

  const body = await request.json() as Record<string, unknown>;
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...body, knowledgeScope: "anglepedia", centralTestMode: true }),
  });
  return chatPost(forwarded);
}

