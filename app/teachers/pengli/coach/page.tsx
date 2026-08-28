import type { Metadata } from "next";
import Link from "next/link";
import PengliCoach from "./PengliCoach";
import "../pengli.css";
import "./coach.css";
import "./verification.css";

export const metadata: Metadata = {
  title: "彭狸 AI 教練｜行政法考點衝刺",
  description: "依彭狸老師行政法考點與解題脈絡進行專屬引導。",
};

export default function PengliCoachPage() {
  return <main className="pengli-coach-page">
    <nav className="pengli-topbar" aria-label="頁面導覽">
      <Link href="/" className="pengli-brand">iBrain Pedia X</Link>
      <div><span>彭狸老師專區</span><b>AI 分身教練</b></div>
      <Link href="/teachers/pengli">回專區首頁</Link>
    </nav>
    <PengliCoach />
  </main>;
}
