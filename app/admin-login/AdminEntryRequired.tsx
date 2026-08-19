export default function AdminEntryRequired({ returnTo }: { returnTo: string }) {
  return <main className="main-entry-gate">
    <section>
      <span>ADMINISTRATOR ACCESS</span>
      <div className="main-entry-logo" aria-hidden="true">智</div>
      <h1>需要管理員驗證</h1>
      <p>這個平台入口只開放給已驗證的管理員，請先登入後再繼續。</p>
      <a className="main-entry-signin" href={`/admin-login?return_to=${encodeURIComponent(returnTo)}`}>登入管理員帳號</a>
    </section>
  </main>;
}
