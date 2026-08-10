"use client";

import Link from "next/link";
import { PracticeLab } from "../plan/practice-lab";

export default function EssayPage() {
  return (
    <main className="essay-standalone-page">
      <header className="essay-standalone-header">
        <Link href="/" className="brand"><span>司</span><b>司律備考</b></Link>
        <nav aria-label="申論頁導覽">
          <a href="/" aria-label="回到司律備考首頁">← 回首頁</a>
        </nav>
      </header>
      <PracticeLab initialType="essay" standalone />
    </main>
  );
}
