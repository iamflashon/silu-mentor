import MedtechPlanDialog from "./MedtechPlanDialog";

export default function MedtechHeaderActions({
  activePoints = false,
  accountLabel: _accountLabel = "我的帳號",
  accountHref: _accountHref = "/medtech/account",
  entitlement,
}: {
  activePoints?: boolean;
  accountLabel?: string;
  accountHref?: string;
  entitlement?: {
    purchased: true;
    startedAt: string;
    availableUntil: string;
  } | null;
}) {
  return (
    <div className="medtech-top-actions">
      <MedtechPlanDialog label="本書方案" compact entitlement={entitlement} />
      <a className="medtech-member-link" href="/medtech/account">
        我的帳號
      </a>
    </div>
  );
}
