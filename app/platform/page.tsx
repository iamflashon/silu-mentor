import Link from "next/link";

const subjects = [
  { code: "LAW", name: "司律備考", desc: "律師、司法官｜練真題、寫申論、找爭點、整摘要", href: "/law", tone: "law", status: "進入司律備考" },
  { code: "ACC", name: "中級會計課業答疑", desc: "中級會計學｜觀念、計算、分錄與準則問答", href: "/accounting", tone: "accounting", status: "開始提問" },
  { code: "MED", name: "醫檢師備考", desc: "醫事檢驗師｜國考題、病例與檢驗判讀", href: "/medtech", tone: "medtech", status: "進入平台" },
];
export default function PlatformEntry() {
  return <main className="platform-entry"><header><span>iBRAIN EXAM PREP</span><h1>選擇你的備考平台</h1><p>每個類科擁有獨立首頁、教材、題庫與 AI 教學方式；帳號與管理後台共用。</p></header><section>{subjects.map((item) => item.href === "#" ? <article className={item.tone} key={item.code} aria-disabled="true"><i>{item.code}</i><h2>{item.name}</h2><p>{item.desc}</p><span>{item.status}</span></article> : <Link href={item.href} className={`${item.tone} platform-card-link`} key={item.code} aria-label={`進入${item.name}`}><i>{item.code}</i><h2>{item.name}</h2><p>{item.desc}</p><strong>{item.status} →</strong></Link>)}</section><footer>類科資料彼此隔離 · 共用會員與管理後台</footer></main>;
}
