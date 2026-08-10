"use client";

import Link from "next/link";
import { PracticeLab } from "../plan/practice-lab";

export default function EssayPage() {
  return (
    <main className="essay-standalone-page">
      <header className="essay-standalone-header">
        <Link href="/" className="brand"><span>司</span><b>司律備考</b></Link>
        <nav aria-label="申論頁導覽">
          <Link href="/">首頁</Link>
          <Link href="/plan">學習專區</Link>
          <Link href="/review">司律評</Link>
        </nav>
      </header>
      <PracticeLab initialType="essay" standalone />
    </main>
  );
}
