"use client";
import { useEffect, useState } from "react";
type Unit = {
  key: string;
  packageName: string;
  packNumber: number;
  questionCount: number;
  label: string;
};
type State = {
  plan: {
    enabled: boolean;
    name: string;
    price: number;
    quota: number;
    standardQuota: number;
    bonusQuota: number;
    promoActive: boolean;
    promoEndsAt: string;
    durationDays: number;
    coachRounds: number;
  };
  aiAccess: {
    active: boolean;
    quotaTotal: number;
    quotaUsed: number;
    remaining: number;
    coachRoundsUsed: number;
    coachRoundsTarget: number;
    startsAt: string | null;
    expiresAt: string | null;
  };
  medtechAccess: { active: boolean; productKey?: string; expiresAt?: string };
  medtechPackAccess?: Array<{ label: string; createdAt: string }>;
};
export default function AiAccessPanel() {
  const [state, setState] = useState<State | null>(null),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [units, setUnits] = useState<Unit[]>([]),
    [unitKey, setUnitKey] = useState("");
  async function load() {
    const response = await fetch("/api/ai-access", { cache: "no-store" });
    if (response.ok) setState((await response.json()) as State);
  }
  useEffect(() => {
    void load();
    const payment = new URLSearchParams(location.search).get("ai_payment");
    if (payment === "success")
      setNotice("LINE Pay 付款成功，AI 學習方案已開通。");
    else if (payment === "cancelled") setNotice("已取消付款，未收取費用。");
    else if (
      payment === "failed" ||
      payment === "invalid" ||
      payment === "missing"
    )
      setNotice("付款尚未完成，沒有新增 AI 使用額度。");
  }, []);
  async function redeem(selected = "") {
    if (!code.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/ai-access", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            ...(selected ? { unitKey: selected } : {}),
          }),
        }),
        data = (await response.json()) as State & {
          error?: string;
          benefitType?: string;
          selectionRequired?: boolean;
          units?: Unit[];
          selectedUnitLabel?: string;
        };
      if (!response.ok) throw new Error(data.error ?? "兌換失敗");
      if (data.selectionRequired) {
        const options = data.units ?? [];
        setUnits(options);
        setUnitKey(options[0]?.key ?? "");
        setNotice("這張券可任選一組題目。請選擇後再確認開通；尚未核銷兌換券。");
        return;
      }
      setCode("");
      setUnits([]);
      setUnitKey("");
      setNotice(
        data.benefitType === "medtech_pack_choice"
          ? `已永久開通：${data.selectedUnitLabel ?? "30 題單元"}`
          : data.benefitType === "medtech_book"
            ? "醫檢書籍方案已開通。"
            : "AI 學習方案已開通。",
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "兌換失敗");
    } finally {
      setBusy(false);
    }
  }
  async function buy() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/ai-access/line-pay/request", {
          method: "POST",
        }),
        data = (await response.json()) as {
          paymentUrl?: string;
          error?: string;
        };
      if (!response.ok || !data.paymentUrl)
        throw new Error(data.error ?? "無法建立付款");
      location.href = data.paymentUrl;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "無法建立付款");
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div id="ai-access" className="account-section">
        <h2>AI 學習方案</h2>
        <p>讀取方案中…</p>
      </div>
    );
  return (
    <div id="ai-access" className="account-section ai-member-access">
      <div className="account-section-heading">
        <h2>AI 學習與兌換券</h2>
        <small>單次購買，不自動續約</small>
      </div>
      {state.aiAccess.active ? (
        <div className="ai-member-status">
          <strong>AI 方案使用中</strong>
          <b>
            剩餘 {state.aiAccess.remaining}／{state.aiAccess.quotaTotal} 次
          </b>
          <span>
            有效至 {new Date(state.aiAccess.expiresAt!).toLocaleString("zh-TW")}
          </span>
        </div>
      ) : (
        <div className="ai-member-offer">
          <div>
            <strong>{state.plan.promoActive ? `限時首購｜NT$${state.plan.price} 享 ${state.plan.quota} 次` : state.plan.name}</strong>
            <span>
              {state.plan.promoActive ? `原有 ${state.plan.standardQuota} 次，加贈 ${state.plan.bonusQuota} 次 · ` : ""}
              啟用後 {state.plan.durationDays} 天內有效
            </span>
            <span>一般 AI 成功回答扣 1 次；官方資料查證成功扣 2 次；失敗不扣。</span>
          </div>
          <b>NT${state.plan.price}</b>
          {state.plan.enabled ? (
            <button type="button" onClick={() => void buy()} disabled={busy}>
              使用 LINE Pay 單次購買
            </button>
          ) : (
            <em>目前尚未開放購買</em>
          )}
        </div>
      )}
      {state.medtechAccess.active && (
        <div className="ai-member-status medtech">
          <strong>醫檢書籍方案使用中</strong>
          <span>
            有效至{" "}
            {new Date(state.medtechAccess.expiresAt!).toLocaleString("zh-TW")}
          </span>
        </div>
      )}
      {!!state.medtechPackAccess?.length && (
        <div className="ai-member-pack-list">
          <strong>已開通的醫檢 30 題單元</strong>
          {state.medtechPackAccess.map((item, index) => (
            <span key={`${item.label}-${index}`}>✓ {item.label}</span>
          ))}
        </div>
      )}
      <div className="activation-redeem">
        <label>
          免費啟用碼／30 題兌換券
          <input
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setUnits([]);
              setUnitKey("");
            }}
            placeholder="IB-AI、IB-MT 或 IB-M30"
          />
        </label>
        <button
          type="button"
          onClick={() => void redeem()}
          disabled={busy || !code.trim()}
        >
          {busy ? "處理中…" : "驗證並兌換"}
        </button>
      </div>
      {!!units.length && (
        <div className="activation-unit-picker">
          <label>
            任選一組尚未開通的題目
            <select
              value={unitKey}
              onChange={(event) => setUnitKey(event.target.value)}
            >
              {units.map((unit) => (
                <option key={unit.key} value={unit.key}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>
          <p>確認後此券才會核銷，選定單元永久開通且不可改選。</p>
          <button
            type="button"
            disabled={busy || !unitKey}
            onClick={() => void redeem(unitKey)}
          >
            {busy ? "開通中…" : "確認開通這組題目"}
          </button>
        </div>
      )}
      {notice && (
        <p className="account-note" role="status">
          {notice}
        </p>
      )}
      <p className="account-note">
        兌換券一碼限一個會員使用一次；30
        題券可任選一組尚未開通的醫檢題目，確認後不可更換。
      </p>
    </div>
  );
}
