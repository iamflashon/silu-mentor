"use client";

type Member = {
  id: number;
  memberId: number;
  displayName: string;
  email: string;
  status: "active" | "disabled";
  canAdmin: boolean;
  permissions: string[];
  entitlement?: { status: string; expiresAt: string; source: string; note: string } | null;
};

const permissionOptions = [
  ["members", "會員管理"],
  ["documents", "文件上傳"],
  ["questions", "題庫管理"],
  ["audio", "語音管理"],
  ["security", "登入安全"],
] as const;

export default function CommercialMemberControls({ members, onReload }: { members: Member[]; onReload: () => Promise<void> }) {
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
    if (!response.ok) window.alert("開通狀態更新失敗，請重新整理後再試。");
    await onReload();
  }

  return <section className="medtech-admin-panel medtech-commercial-members">
    <h2>會員開通狀況與管理權限</h2>
    <p className="medtech-admin-help">只有總管理者可開通、延長或取消期限；勾選的功能才會交由該管理員操作。</p>
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
          {permissionOptions.map(([value, label]) => <label key={value}><input type="checkbox" disabled={!member.canAdmin} checked={member.permissions.includes(value)} onChange={(event) => void patchMember(member.id, { permissions: event.target.checked ? [...new Set([...member.permissions, value])] : member.permissions.filter((item) => item !== value) })}/>{label}</label>)}
        </div>
      </article>)}
    </div>
  </section>;
}
