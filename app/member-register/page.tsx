import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function MemberRegisterPage({ searchParams }:{ searchParams?:Promise<{return_to?:string}> }) {
  const params = await searchParams;
  const returnTo = params?.return_to || "/";
  if (await getChatGPTUser()) redirect(returnTo);
  redirect(chatGPTSignInPath(returnTo));
}
