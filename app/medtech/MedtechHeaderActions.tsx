export default function MedtechHeaderActions({
  activePoints = false,
  accountLabel = "我的帳號",
}: {
  activePoints?: boolean;
  accountLabel?: string;
}) {
  return (
    <div className="medtech-top-actions">
      <a
        className={`medtech-points-link${activePoints ? " active" : ""}`}
        href="/medtech/pricing"
      >
        全庫方案
      </a>
      <a className="medtech-member-link" href="/medtech/account">
        {accountLabel}
      </a>
    </div>
  );
}
