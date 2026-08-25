export async function POST() {
  return Response.json({
    error: "公開註冊已停用。請使用 ChatGPT 帳號登入，並由管理員開通平台資格。",
    signIn: "/signin-with-chatgpt?return_to=%2F",
  }, { status: 410, headers: { "cache-control": "no-store" } });
}
