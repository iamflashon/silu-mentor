export async function POST() {
  return Response.json({
    error: "管理員帳密登入已停用，請使用具管理權限的 ChatGPT 帳號登入。",
    signIn: "/signin-with-chatgpt?return_to=%2Fadmin",
  }, { status: 410, headers: { "cache-control": "no-store" } });
}
