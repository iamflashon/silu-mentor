"use client";

import { useState } from "react";

type Member = {
  id: number;
  memberId: number;
  displayName: string;
  email: string;
  status: "active" | "disabled";
  canAdmin: boolean;
  permissions: string[];
  entitlement?: { status: string; expiresAt: string; source: string; note: string } | null;
  paymentOrders?: Array<{
    orderId: string;
    transactionId: string | null;
    packageName: string;
    amount: number;
    currency: string;
    status: string;
    environment: string;
    paidAt: string | null;
    activatedAt: string | null;
    createdAt: string;
  }>;
};

const permissionOptions = [
  ["members", "會員管理"],
  ["documents", "文件上傳"],
  ["questions", "文件題庫編修"],
  ["security", "登入安全"],
] as const;

export default function CommercialMemberControls({ members, onReload }: { members: Member[]; onReload: () => Promise<void> }) {
  const [memberEmail, setMemberEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [notice, setNotice] = useState("");
  async function patchMember(id: number, patch: Record<string, unknown>) {
    await fetch("/api/medtech/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    await onReload();
  }

  async function changeEntitlement(member: Member, action: "grant" | "extend" | "revoke") {
    const raw = action === "revoke" ? "0" : window.prompt(action === "grant" ? "要開通幾天？" : "要再延長幾天？", "30");
    if (raw === null) return;
    const days = Math.max(1, Math.floor(Number(raw) || 30));
    const response = await fetch("/api/medtech/admin/entitlements", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: member.memberId, action, days, note: action === "revoke" ? "總管理者取消開通" : `總管理者${action === "grant" ? "開通" : "延長"} ${days} 天` }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      window.alert(data.error ?? `開通狀態更新失敗（HTTP ${response.status}），請重新整理後再試。`);
    }
    await onReload();
  }

  async function grantByEmail() {
    const email = memberEmail.trim().toLowerCase();
    if (!email) return setNotice("請輸入總會員 Email。");
    const raw = window.prompt("要開通幾天？", "30");
    if (raw === null) return;
    const days = Math.max(1, Math.floor(Number(raw) || 30));
    setGranting(true);
    setNotice("正在建立醫檢資格並開通…");
    try {
      const response = await fetch("/api/medtech/admin/entitlements", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, action: "grant", days, note: `總管理者依總會員 Email 人工開通 ${days} 天` }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; member?: { displayName?: string } };
      if (!response.ok) return setNotice(data.error ?? "人工開通失敗，請重新整理後再試。");
      setNotice(`已為 ${data.member?.displayName || email} 開通 ${days} 天，並加入醫檢會員名單。`);
      setMemberEmail("");
      await onReload();
    } finally {
      setGranting(false);
    }
  }

  return <section className="medtech-admin-panel medtech-commercial-members">
    <h2>會員開通狀況與管理權限</h2>
    <p className="medtech-admin-help">只有總管理者可開通、延長或取消期限；勾選的功能才會交由該管理員操作。</p>
    <div className="medtech-entitlement-email-grant">
      <label>總會員 Email<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="輸入總管理處已有的會員 Email" /></label>
      <button type="button" disabled={granting} onClick={() => void grantByEmail()}>{granting ? "開通中…" : "加入醫檢並人工開通"}</button>
      {notice && <p role="status">{notice}</p>}
    </div>
    <div className="medtech-commercial-member-list">
      {members.map((member) => <article key={member.id}>
        <div className="medtech-commercial-member-person"><b>{member.displayName}</b><span>{member.email}</span></div>
        <div className="medtech-commercial-entitlement">
          <strong>{member.entitlement?.status === "active" ? "已開通" : "未開通"}</strong>
          <span>{member.entitlement?.expiresAt ? `至 ${new Date(member.entitlement.expiresAt).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" })}` : "尚無使用期限"}</span>
          <div><button onClick={() => void changeEntitlement(member, member.entitlement?.status === "active" ? "extend" : "grant")}>{member.entitlement?.status === "active" ? "延長期限" : "立即開通"}</button>{member.entitlement?.status === "active" && <button className="danger" onClick={() => void changeEntitlement(member, "revoke")}>取消開通</button>}</div>
        </div>
        <div className="medtech-commercial-permissions">
          <label><input type="checkbox" checked={member.canAdmin} onChange={(event) => void patchMember(member.id, { canAdmin: event.target.checked })}/>可進管理後台</label>
          {permissionOptions.map(([value, label]) => <label key={value}><input type="checkbox" disabled={value !== "questions" && !member.canAdmin} checked={member.permissions.includes(value)} onChange={(event) => void patchMember(member.id, { permissions: event.target.checked ? [...new Set([...member.permissions, value])] : member.permissions.filter((item) => item !== value) })}/>{label}</label>)}
        </div>
        <details className="medtech-admin-payment-history">
          <summary>購買紀錄（{member.paymentOrders?.length ?? 0} 筆）</summary>
          {member.paymentOrders?.length ? <div>
            {member.paymentOrders.map((order) => <article key={order.orderId}>
              <strong>{order.packageName}</strong>
              <span>{order.currency} {order.amount} · {order.status === "paid" ? "已付款" : order.status === "pending" ? "待付款" : order.status}</span>
              <small>訂單 {order.orderId}{order.transactionId ? ` · 交易 ${order.transactionId}` : ""}</small>
              <small>{order.paidAt ? `付款：${new Date(order.paidAt).toLocaleString("zh-TW")}` : `建立：${new Date(order.createdAt).toLocaleString("zh-TW")}`}{order.activatedAt ? ` · 開通：${new Date(order.activatedAt).toLocaleString("zh-TW")}` : ""}</small>
            </article>)}
          </div> : <p>目前沒有付款訂單。</p>}
        </details>
      </article>)}
    </div>
  </section>;
}
