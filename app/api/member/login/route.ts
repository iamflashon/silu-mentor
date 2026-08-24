export async function POST() {
  return Response.json({
    error: "帳密登入已停用，請使用 ChatGPT 帳號登入。",
    signIn: "/signin-with-chatgpt?return_to=%2F",
  }, { status: 410, headers: { "cache-control": "no-store" } });
}
