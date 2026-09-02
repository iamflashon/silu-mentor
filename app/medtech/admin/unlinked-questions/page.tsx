"use client";

import QuestionBank from "../QuestionBank";
import { useMedtechAdminAccess } from "../MedtechAdminAccess";

export default function Page(){
 const { fullAdmin } = useMedtechAdminAccess();
 return fullAdmin ? <main className="medtech-admin-page"><header><a href="/medtech/admin" className="medtech-brand"><span>醫</span><div><b>舊題庫／未配對題目</b><small>MEDTECH QUESTIONS</small></div></a><nav><a href="/medtech/admin">返回文件題庫</a></nav></header><QuestionBank/></main> : <main className="medtech-member-page"><section className="medtech-member-card login"><h1>此帳號只能使用文件題庫</h1><a className="primary" href="/medtech/admin/document-library">回醫檢文件題庫</a></section></main>;
}
