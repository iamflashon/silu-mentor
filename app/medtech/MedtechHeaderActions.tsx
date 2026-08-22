import MedtechPlanDialog from "./MedtechPlanDialog";

export default function MedtechHeaderActions({
  activePoints = false,
  accountLabel = "我的帳號",
}: {
  activePoints?: boolean;
  accountLabel?: string;
}) {
  return (
    <div className="medtech-top-actions">
      <MedtechPlanDialog label="本書方案" compact />
      <a className="medtech-member-link" href="/medtech/account">
        {accountLabel}
      </a>
    </div>
  );
}
