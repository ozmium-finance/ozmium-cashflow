import { money, partyLabel, shortCid } from "../lib/format";

export default function Card({ stageKey, ev }) {
  const a = ev.createArgument || {};
  const cid = ev.contractId || "";
  let fields = [];

  switch (stageKey) {
    case "attestation":
      fields = [
        ["Asset", a.assetId],
        ["Type", a.revenueType],
        ["Period", `${a.periodStart} → ${a.periodEnd}`],
        ["Gross", money(a.grossAmount, a.currency)],
        ["Attestor", partyLabel(a.attestor)],
      ];
      break;
    case "validation":
      fields = [
        ["Asset", a.assetId],
        ["Net (NOI)", money(a.netDistributable, a.currency)],
        ["Fund", partyLabel(a.fund)],
        ["Attestor", partyLabel(a.attestor)],
      ];
      break;
    case "distribution":
      fields = [
        ["Asset", a.assetId],
        ["NOI", money(a.netOperatingIncome, a.currency)],
        ["Retained", money(a.retentionAmount, a.currency)],
        ["Reason", a.retentionReason || "—"],
        ["Pass-through", money(a.passThroughAmount, a.currency)],
      ];
      break;
    case "allocation": {
      const allocations = Array.isArray(a.allocations) ? a.allocations : [];
      const schedule = a.schedule || {};
      fields = [
        ["Asset", a.assetId],
        ["Token", a.tokenSymbol],
        ["Holders", String(allocations.length)],
        ["Cliff / vest (days)", `${schedule.cliffDays ?? "—"} / ${schedule.vestingDays ?? "—"}`],
        ["Issuer", partyLabel(a.issuer)],
      ];
      break;
    }
    case "entitlement": {
      const lines = Array.isArray(a.lines) ? a.lines : [];
      fields = [
        ["Asset", a.assetId],
        ["Distributable", money(a.netDistributable, a.currency)],
        ["Holders", String(lines.length)],
      ];
      break;
    }
    case "settlement":
      fields = [
        ["Holder", partyLabel(a.holder)],
        ["Amount", money(a.amount, a.currency)],
        ["Status", a.status],
        ["Source", a.sourceEventRef],
      ];
      break;
    default:
      break;
  }

  return (
    <div className="card">
      {fields.map(([k, v]) => (
        <div className="field" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v ?? "—"}</span>
        </div>
      ))}
      <div className="cid" title={cid}>{shortCid(cid)}</div>
    </div>
  );
}
