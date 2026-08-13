import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setInvestorParty } from "../store/uiSlice";
import { apiFetch, fetchActiveContractsForParty, listOwnKnownPartyEntries } from "../lib/api";
import { money, num, partyLabel } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

// One honest limitation carried over from the old dashboard/investor.html:
// SettlementInstruction results here are genuinely private per investor
// at the ledger level (filtersByParty, each contract has a single holder
// as observer). EntitlementCalculation is different -- right now it's
// one shared contract with every holder as observer, so this page only
// *displays* the signed-in investor's own line by filtering client-side.
// That's a UI convenience, not a ledger guarantee yet; a later milestone
// should move to per-holder entitlement contracts instead.
export default function InvestorPage() {
  const dispatch = useDispatch();
  const investorParty = useSelector((s) => s.ui.investorParty);

  const [knownParties, setKnownParties] = useState(null); // null = still loading
  const [manualEntry, setManualEntry] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [status, setStatus] = useState("idle");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const [entitlements, setEntitlements] = useState([]);
  const [settlements, setSettlements] = useState([]);

  useEffect(() => {
    // Synchronous now -- listOwnKnownPartyEntries just reads the same
    // localStorage cache getOrAllocateParty already maintains, no
    // ledger round trip. Empty means Setup hasn't been run yet in this
    // browser (or its cache was cleared) -- same "fall back to manual
    // entry" behavior as before for that case.
    const entries = listOwnKnownPartyEntries();
    if (entries.length === 0) {
      setKnownParties([]);
      setManualEntry(true);
      return;
    }
    const list = entries.map(([, party]) => party);
    setKnownParties(list);
    if (!investorParty) {
      // stepSetup allocates Admin first, so entries[0] is Admin, not an
      // investor -- an "Investor View" defaulting to Admin is a
      // confusing first impression. Prefer whichever cached hint
      // actually contains "Investor" (InvestorAlice/Bob/Carol), falling
      // back to the first entry if Setup somehow never ran the investor
      // allocations at all.
      const preferred = entries.find(([hint]) => hint.includes("Investor"));
      dispatch(setInvestorParty((preferred || entries[0])[1]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeParty = manualEntry ? manualValue.trim() : investorParty;

  const load = useCallback(async () => {
    if (!activeParty) return;
    try {
      const events = await fetchActiveContractsForParty(activeParty);

      const ent = [];
      for (const ev of events) {
        if (!ev.templateId?.endsWith(":Ozmium.Entitlement:EntitlementCalculation")) continue;
        const a = ev.createArgument || {};
        const myLine = (a.lines || []).find((l) => l.holder === activeParty);
        if (myLine) ent.push({ assetId: a.assetId, currency: a.currency, share: myLine.share, amount: myLine.amount });
      }
      const settle = events
        .filter((ev) => ev.templateId?.endsWith(":Ozmium.Settlement:SettlementInstruction"))
        .map((ev) => ev.createArgument || {});

      setEntitlements(ent);
      setSettlements(settle);
      setError(null);
      setStatus("ok");
      setLastUpdate(new Date().toISOString());
    } catch (err) {
      setStatus("err");
      setError(err.message);
    }
  }, [activeParty]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const totalEntitled = entitlements.reduce((sum, r) => sum + (num(r.amount) || 0), 0);
  const totalPaid = settlements.filter((r) => r.status === "Paid").reduce((sum, r) => sum + (num(r.amount) || 0), 0);
  const totalPending = settlements.filter((r) => r.status !== "Paid").reduce((sum, r) => sum + (num(r.amount) || 0), 0);

  return (
    <>
      <Head><title>Ozmium — Investor View</title></Head>
      <header>
        <div>
          <h1>Ozmium — Investor View</h1>
          <div className="sub">Your own entitlements and settlements</div>
        </div>
        <div className="controls">
          {!manualEntry && (
            <select value={investorParty} onChange={(e) => dispatch(setInvestorParty(e.target.value))}>
              {knownParties === null && <option value="">Loading known parties…</option>}
              {(knownParties || []).map((p) => (
                <option key={p} value={p}>{partyLabel(p)}</option>
              ))}
            </select>
          )}
          {manualEntry && (
            <input
              type="text"
              placeholder="Paste a party id"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
            />
          )}
          <StatusBadge status={status} lastUpdate={lastUpdate} okPrefix="loaded" />
        </div>
      </header>

      {status === "err" && (
        <div id="errorBanner">
          {`Couldn't load this party's contracts:\n${error}\n\nCheck the JSON API is reachable and the terminal running "npm run dev" for proxy errors.`}
        </div>
      )}
      {activeParty && (
        <div id="noteBanner">
          Entitlement figures below are filtered to your own line for display purposes -- see the comment
          at the top of this page's source for why that's a UI-level filter, not yet a ledger-level
          privacy guarantee for this particular contract.
        </div>
      )}

      <main>
        <div className="summary">
          <div className="stat"><div className="label">Total entitled</div><div className="value">{money(totalEntitled)}</div></div>
          <div className="stat"><div className="label">Total paid</div><div className="value">{money(totalPaid)}</div></div>
          <div className="stat"><div className="label">Total pending</div><div className="value">{money(totalPending)}</div></div>
        </div>

        <section>
          <h2>My Entitlements</h2>
          {entitlements.length === 0 ? (
            <div className="empty">No entitlement calculations found for this party yet.</div>
          ) : (
            <table>
              <thead><tr><th>Asset</th><th>Share</th><th>Amount</th></tr></thead>
              <tbody>
                {entitlements.map((r, i) => (
                  <tr key={i}>
                    <td>{r.assetId}</td>
                    <td>{((num(r.share) || 0) * 100).toFixed(1)}%</td>
                    <td>{money(r.amount, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>My Settlements</h2>
          {settlements.length === 0 ? (
            <div className="empty">No settlements found for this party yet.</div>
          ) : (
            <table>
              <thead><tr><th>Asset</th><th>Amount</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {settlements.map((r, i) => (
                  <tr key={i}>
                    <td>{r.assetId}</td>
                    <td>{money(r.amount, r.currency)}</td>
                    <td><span className={`pill ${r.status === "Paid" ? "paid" : "pending"}`}>{r.status}</span></td>
                    <td className="mono">{r.sourceEventRef || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
