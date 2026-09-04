import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./posner.css";
import "./thumbnail.css";
import "./commerce.css";

export const metadata: Metadata = {
  title: "波斯納書店咖啡館｜影音讀書館",
  description: "波斯納書店咖啡館的線上影音課程、重點摘要與學習進度。",
};

export default function PosnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="posner-shell">
      <header className="posner-header">
        <Link className="posner-brand" href="/posner" aria-label="回波斯納影音讀書館首頁">
          <Image src="/posner/logo.jpg" alt="波斯納書店咖啡館" width={72} height={72} priority />
          <span><b>POSNER</b><small>波斯納影音讀書館</small></span>
        </Link>
        <nav aria-label="波斯納主要選單">
          <Link href="/posner#courses">探索課程</Link>
          <Link href="/posner/my-courses">我的課程</Link>
          <a className="posner-account-link" href="/member-login?return_to=%2Fposner%2Fmy-courses">登入</a>
        </nav>
      </header>
      {children}
      <footer className="posner-footer">
        <div><b>POSNER</b><span>波斯納書店咖啡館 · Bookstore Cafe</span></div>
        <p>線上課程，保留一間書店應有的安靜與深度。</p>
      </footer>
    </div>
  );
}
