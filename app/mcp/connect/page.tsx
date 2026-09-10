import Link from "next/link";
import ConnectMcpClient from "./ConnectMcpClient";
import styles from "./connect.module.css";

export const dynamic = "force-dynamic";

export default function ConnectMcpPage() {
  return <main className={styles.page}>
    <nav><Link href="/">← 回學習平台</Link><span>iBrain Student MCP</span></nav>
    <section className={styles.card}>
      <header><span className={styles.mark}>智</span><div><small>USE YOUR OWN CHATGPT</small><h1>把考試顧問加到自己的 ChatGPT</h1></div></header>
      <p className={styles.lead}>模型使用量由同學自己的 ChatGPT 方案負擔；平台只提供已授權資源搜尋與個人陪考進度。</p>
      <ConnectMcpClient />
      <ol>
        <li><b>在 ChatGPT 新增自訂 MCP／連接器</b><span>貼上上方網址，開始連線。</span></li>
        <li><b>使用同一個 ChatGPT 帳號授權</b><span>只有平台已開通的會員可以完成連接。</span></li>
        <li><b>開始詢問</b><span>例如：「搜尋適合司律二試行政法的高點資源，再依我的進度安排今天任務。」</span></li>
      </ol>
      <div className={styles.tools}>
        <article><b>搜尋高點資源</b><span>只回傳已審核、已發布且真的命中的資料。</span></article>
        <article><b>接續備考進度</b><span>讀取最近紀錄、弱點與下一個行動。</span></article>
        <article><b>保存陪考打卡</b><span>必須在同學同意後才會寫入。</span></article>
      </div>
      <aside>平台不會取得 ChatGPT 密碼，也不會要求同學提供 OpenAI API Key。每個帳號每日預設最多呼叫 100 次 MCP 工具。</aside>
    </section>
  </main>;
}
