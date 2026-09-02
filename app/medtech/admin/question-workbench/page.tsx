"use client";

import QuestionWorkbenchPage from "./QuestionWorkbenchPage";
import { useMedtechAdminAccess } from "../MedtechAdminAccess";

export default function Page(){
  const { fullAdmin } = useMedtechAdminAccess();
  return fullAdmin ? <QuestionWorkbenchPage/> : <main className="medtech-member-page"><section className="medtech-member-card login"><h1>此帳號只能使用文件題庫</h1><p>請從獲准書本進入原稿對照工作區。</p><a className="primary" href="/medtech/admin/document-library">回醫檢文件題庫</a></section></main>;
}
