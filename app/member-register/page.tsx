import { redirect } from "next/navigation";
import { chatGPTSignInPath } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function MemberRegisterPage({ searchParams }:{ searchParams?:Promise<{return_to?:string}> }) {
  const params = await searchParams;
  redirect(chatGPTSignInPath(params?.return_to || "/"));
}
