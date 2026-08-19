"use client";

import { useEffect, useMemo, useState } from "react";

type LedgerRow = {
  id: number;
  delta: number;
  balanceAfter: number;
  action: string;
  description: string;
  questionId: number | null;
  sourceDetail: string | null;
  createdAt: string;
  availableUntil: string | null;
};

type QuestionSource = {
  id: number;
  year: string;
  questionNumber: string;
  subject: string;
  stem: string;
};

function formatTaipeiTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days} 天 ${hours} 小時 ${minutes} 分`;
  if (hours > 0) return `${hours} 小時 ${minutes} 分 ${seconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}

export default function PointLedgerList({ history, questionSources }: { history: LedgerRow[]; questionSources: QuestionSource[] }) {
  const [now, setNow] = useState(() => Date.now());
  const sourceMap = useMemo(() => new Map(questionSources.map((source) => [source.id, source])), [questionSources]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="medtech-point-history-list">{history.map((row) => {
    const source = row.questionId ? sourceMap.get(row.questionId) : undefined;
    const inferredHours = row.action === "question_view" || row.action === "question_pack" || row.action === "question_pack_gift"
      ? row.description.includes("24 小時") ? 24 : 7 * 24
      : row.action === "audio_complete" || row.action === "complete_explanation" ? 24 : null;
    const inferredExpiry = inferredHours === null ? null : new Date(row.createdAt).getTime() + inferredHours * 60 * 60 * 1000;
    const expiry = row.availableUntil ? new Date(row.availableUntil).getTime() : inferredExpiry;
    const expiryIso = row.availableUntil ?? (inferredExpiry === null ? null : new Date(inferredExpiry).toISOString());
    const active = expiry !== null && expiry > now;
    const isCharge = row.delta < 0;
    const accessLabel = row.action === "question_view" || row.action === "question_pack" || row.action === "question_pack_gift" ? "7 天" : "24 小時";
    return <article key={row.id}>
      <div>
        <b>{row.description}</b>
        <small>{formatTaipeiTime(row.createdAt)}</small>
      </div>
      <strong className={row.delta > 0 ? "plus" : row.delta < 0 ? "minus" : "neutral"}>{row.delta > 0 ? "+" : ""}{row.delta} 點</strong>
      <span>餘額 {row.balanceAfter} 點</span>
      <details className="medtech-point-ledger-detail">
        <summary>查看來源與使用狀態</summary>
        {source && <p><b>題目來源：</b>{source.year} 年・第 {source.questionNumber} 題・{source.subject}</p>}
        {row.sourceDetail && <p><b>{isCharge ? "扣點原因：" : "紀錄說明："}</b>{row.sourceDetail}</p>}
        {source && <p className="medtech-point-source-stem"><b>題目：</b>{source.stem}</p>}
        {(isCharge || row.action === "question_pack_gift") && expiry !== null && expiryIso && <p className={active ? "medtech-point-access active" : "medtech-point-access expired"}>
          {active ? `本次 ${accessLabel} 使用權剩餘 ${formatRemaining(expiry - now)}；期限至 ${formatTaipeiTime(expiryIso)}` : `本次 ${accessLabel} 使用權已到期；現在重新使用才會再次扣點。`}
        </p>}
        {isCharge && expiry === null && <p className="medtech-point-access neutral-note">本次使用已扣點；若功能有使用期限，系統會在此顯示倒數。</p>}
      </details>
    </article>;
  })}</div>;
}
