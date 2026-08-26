import type { Metadata } from "next";
import Link from "next/link";
import AiAccessClient from "./AiAccessClient";
import "../pengli.css";
import "./ai-access.css";

export const metadata: Metadata = { title: "AI 次數與兌換碼｜彭狸老師專區", description: "購買或兌換彭狸 AI 陪練次數。" };

export default function PengliAiAccessPage() {
  return <main className="pengli-ai-access-page"><nav className="pengli-topbar"><Link href="/">iBrain Pedia X</Link><div><span>彭狸老師專區</span><b>AI 次數</b></div><Link href="/teachers/pengli">回專區首頁</Link></nav><AiAccessClient /></main>;
}
