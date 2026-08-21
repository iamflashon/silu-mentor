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
        題目包價格
      </a>
      <a className="medtech-member-link" href="/medtech/account">
        {accountLabel}
      </a>
    </div>
  );
}
