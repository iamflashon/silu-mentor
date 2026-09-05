import type { Metadata } from "next";
import Link from "next/link";
import ChapterReader from "./ChapterReader";
import "../pengli.css";
import "./reader.css";
import "./reader-continuous.css";

export const metadata: Metadata = {
  title: "彭狸行政法章節閱讀｜學霸讀書室",
  description: "依八大主題閱讀站內重新排版的行政法教材內容。",
};

export default function PengliReaderPage() {
  return <main className="pengli-reader-page">
    <nav className="pengli-topbar" aria-label="頁面導覽">
      <Link href="/" className="pengli-brand">iBrain Pedia X</Link>
      <div><span>彭狸老師專區</span><b>章節閱讀</b></div>
      <div className="pengli-top-actions"><Link href="/teachers/pengli/coach">行政法教練</Link><Link href="/teachers/pengli">回專區首頁</Link></div>
    </nav>
    <ChapterReader />
  </main>;
}
