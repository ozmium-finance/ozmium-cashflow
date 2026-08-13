import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setAuditSearch, setAuditStatusFilter } from "../store/uiSlice";
import { fetchActiveContracts, fetchHistoricalCreates } from "../lib/api";
import { money, num, partyLabel } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

// Reads *active* contracts only, which shows the current state of each
// settlement (Pending or Paid) but not the full history of every state
// transition -- Settlement_MarkPaid archives the old instruction and
// creates a new one, so the Pending version is gone from active-contracts
// once it's paid, not kept around as history. A true deep audit trail
// (every version, every transition, timestamped) would read the
// transaction stream (/v2/updates) instead -- bigger piece of work, not
// built here. What's here answers "trace this payout back to its source
// event," not yet "show me the full history of this contract over time."
export default function AuditPage() {
  const dispatch = useDispatch();
  const search = useSelector((s) => s.ui.auditSearch);
  const statusFilter = useSelector((s) => s.ui.auditStatusFilter);

  const [allRows, setAllRows] = useState([]);
  const [status, setStatus] = useState("idle");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const events = await fetchActiveContracts();
      // Best-effort -- if the request shape this participant's version
      // of /v2/updates/flats actually wants turns out to differ from
      // what fetchHistoricalCreates guessed, trace-back just falls back
      // to active-contracts-only matching (the old, known-incomplete
      // behavior) instead of taking the whole page down.
      let historical = [];
      try {
        historical = await fetchHistoricalCreates();
      } catch (err) {
        console.warn("fetchHistoricalCreates failed, trace-back will be incomplete:", err.message);
      }

      // Every step from attestation through settlement is a *consuming*
      // choice (Attestation_Validate archives RevenueAttestation,
      // ValidatedRevenueEvent_DecideDistribution archives that,
      // EntitlementCalculation_Settle archives *that*) -- so by the time
      // a SettlementInstruction exists, every upstream contract that
      // could explain where it came from has already been archived.
      // fetchActiveContracts alone can never find them; fetchHistoricalCreates
      // reads the transaction stream instead, which still has a record
      // of contracts that are no longer active. RevenueAttestation and
      // ValidatedRevenueEvent both carry the same
      // attestor/grossAmount/currency/periodStart/periodEnd/sourceRef
      // shape the trace-back string below needs, so either is fine to
      // match on -- whichever this specific settlement's chain still
      // has a record of.
      const attestationsByRef = {};
      for (const ev of [...events, ...historical]) {
        if (
          ev.templateId?.endsWith(":Ozmium.Attestation:RevenueAttestation") ||
          ev.templateId?.endsWith(":Ozmium.Validation:ValidatedRevenueEvent")
        ) {
          const a = ev.createArgument || {};
          attestationsByRef[a.sourceRef] = a;
        }
      }

      const rows = events
        .filter((ev) => ev.templateId?.endsWith(":Ozmium.Settlement:SettlementInstruction"))
        .map((ev) => {
          const a = ev.createArgument || {};
          const source = attestationsByRef[a.sourceEventRef];
          return {
            contractId: ev.contractId,
            holder: partyLabel(a.holder),
            assetId: a.assetId,
            amount: num(a.amount),
            currency: a.currency,
            status: a.status,
            sourceEventRef: a.sourceEventRef,
            tracedTo: source
              ? `${money(source.grossAmount, source.currency)} attested by ${partyLabel(source.attestor)}, ${source.periodStart} → ${source.periodEnd}`
              : null,
          };
        });

      setAllRows(rows);
      setError(null);
      setStatus("ok");
      setLastUpdate(new Date().toISOString());
    } catch (err) {
      setStatus("err");
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const q = search.trim().toLowerCase();
  const filteredRows = allRows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (!q) return true;
    return [r.holder, r.assetId, r.sourceEventRef, r.contractId].some((f) => (f || "").toLowerCase().includes(q));
  });

  function exportCsv() {
    if (filteredRows.length === 0) return;
    const headers = ["Holder", "Asset", "Amount", "Currency", "Status", "SourceEventRef", "TracedTo", "ContractId"];
    const csvRows = [headers.join(",")];
    for (const r of filteredRows) {
      const line = [r.holder, r.assetId, r.amount, r.currency, r.status, r.sourceEventRef, r.tracedTo || "", r.contractId]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
      csvRows.push(line.join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ozmium-settlements-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head><title>Ozmium — Audit Trail</title></Head>
      <header>
        <div>
          <h1>Ozmium — Audit Trail Explorer</h1>
          <div className="sub">Every settlement, traced back to its source attestation</div>
        </div>
        <div className="controls">
          <button className="secondary" onClick={exportCsv}>Export CSV</button>
          <StatusBadge status={status} lastUpdate={lastUpdate} okPrefix="loaded" />
        </div>
      </header>

      {status === "err" && (
        <div id="errorBanner">{`Couldn't load settlements:\n${error}`}</div>
      )}

      <main>
        <div className="toolbar">
          <input
            id="search"
            type="text"
            placeholder="Search by holder, asset, source reference, or contract id…"
            value={search}
            onChange={(e) => dispatch(setAuditSearch(e.target.value))}
          />
          <select value={statusFilter} onChange={(e) => dispatch(setAuditStatusFilter(e.target.value))}>
            <option value="">All statuses</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
        <div className="count">
          {filteredRows.length} of {allRows.length} settlement instruction{allRows.length === 1 ? "" : "s"}
        </div>
        {filteredRows.length === 0 ? (
          <div className="empty">No settlements match.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Holder</th><th>Asset</th><th>Amount</th><th>Status</th><th>Source Reference</th><th>Traces back to</th></tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.contractId}>
                  <td>{r.holder}</td>
                  <td>{r.assetId}</td>
                  <td>{money(r.amount, r.currency)}</td>
                  <td><span className={`pill ${r.status === "Paid" ? "paid" : "pending"}`}>{r.status}</span></td>
                  <td className="mono">{r.sourceEventRef || "—"}</td>
                  <td className={`trace ${r.tracedTo ? "found" : ""}`}>{r.tracedTo || "no matching attestation found"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
