import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { fetchActiveContracts } from "../lib/api";
import { canonicalSettlementRecord, sha256HexOfUtf8, verifyChainDetailed } from "../lib/proofChain";
import { shortCid } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

// Week 6 -- the public verification page Ozmium.ProofLog's own header
// comment describes: verifyChain is written as a plain function
// specifically so this page can run the identical check client-side,
// in the visitor's own browser, instead of asking them to trust a
// server that says "looks fine." Every hash computed on this page uses
// Web Crypto (lib/proofChain.js) and runs locally -- nothing here is
// computed server-side or sent anywhere for checking.
//
// One honest limitation, matching this codebase's own convention of
// flagging what's real vs demo-only (see README's Known Limitations):
// "public" here means "doesn't need this fund's own signing key to
// read" -- ProofLogEntry has no explicit observer clause today, so
// fetchActiveContracts still relies on this app's own broad devnet
// read access, the same access every other page here already uses,
// not a truly unauthenticated public read. A genuinely public
// deployment would need ProofLogEntry to name an observer (or a
// dedicated public-read party) so a visitor with no credentials at all
// could pull these entries directly from the JSON API themselves. The
// hash-chain math on this page is real and independent either way --
// only "who can fetch the entries" has this caveat.
export default function VerifyPage() {
  const [entries, setEntries] = useState(null); // null = still loading
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [chainResult, setChainResult] = useState(null);

  const [statementText, setStatementText] = useState("");
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const events = await fetchActiveContracts();
      const raw = events
        .filter((ev) => ev.templateId?.endsWith(":Ozmium.ProofLog:ProofLogEntry"))
        .map((ev) => ev.createArgument || {});
      const parsed = raw
        .map((a) => ({
          sequenceNo: typeof a.sequenceNo === "string" ? parseInt(a.sequenceNo, 10) : a.sequenceNo,
          previousHash: a.previousHash,
          eventRef: a.eventRef,
          payloadHash: a.payloadHash,
          entryHash: a.entryHash,
        }))
        .sort((a, b) => a.sequenceNo - b.sequenceNo);

      setEntries(parsed);
      const result = await verifyChainDetailed(parsed);
      setChainResult(result);
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
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function checkStatement() {
    setChecking(true);
    setCheckResult(null);
    try {
      const statement = JSON.parse(statementText);
      const record = canonicalSettlementRecord(statement);
      const payloadHash = await sha256HexOfUtf8(record);
      const eventRef = `${statement.sourceEventRef}:${statement.holder}`;

      const match = (entries || []).find((e) => e.eventRef === eventRef);
      if (!match) {
        setCheckResult({ ok: false, message: `No proof log entry found for "${eventRef}" -- this settlement was either never anchored, or the sourceEventRef/holder here don't match what's on the ledger.` });
      } else if (match.payloadHash !== payloadHash) {
        setCheckResult({ ok: false, message: `Entry #${match.sequenceNo} exists for "${eventRef}", but its payloadHash doesn't match this statement's own hash -- either this statement was altered, or the entry was.`, entry: match });
      } else {
        setCheckResult({ ok: true, message: `Confirmed -- entry #${match.sequenceNo} anchors exactly this statement, and its hash matches what's on the ledger.`, entry: match });
      }
    } catch (err) {
      setCheckResult({ ok: false, message: `Couldn't check this statement: ${err.message}` });
    } finally {
      setChecking(false);
    }
  }

  const genesisMissing = entries && entries.length === 0;

  return (
    <>
      <Head><title>Ozmium — Verify</title></Head>
      <header>
        <div>
          <h1>Ozmium — Verify a Proof</h1>
          <div className="sub">Runs entirely in your browser — nothing here is computed server-side</div>
        </div>
        <div className="controls">
          <StatusBadge status={status} lastUpdate={lastUpdate} okPrefix="loaded" />
        </div>
      </header>

      {status === "err" && (
        <div id="errorBanner">
          {`Couldn't load the proof log:\n${error}\n\nCheck the JSON API is reachable and the terminal running "npm run dev" for proxy errors.`}
        </div>
      )}

      <div id="noteBanner">
        This page re-derives every hash itself (Web Crypto, in your browser) and checks it against
        Ozmium.ProofLog's own chain rule — it does not ask a server whether the chain is valid. See this
        page's source for one honest caveat about who can currently fetch the entries in the first place.
      </div>

      <main>
        <section>
          <h2>Chain status</h2>
          {entries === null ? (
            <div className="empty">Loading proof log entries…</div>
          ) : genesisMissing ? (
            <div className="empty">No proof log entries found yet — run the OZM SAFT vesting scenario's settlement steps first.</div>
          ) : (
            <>
              <div className="summary">
                <div className="stat">
                  <div className="label">Entries</div>
                  <div className="value">{entries.length}</div>
                </div>
                <div className="stat">
                  <div className="label">Chain integrity</div>
                  <div className="value">
                    <span className={`pill ${chainResult?.ok ? "ok" : "broken"}`}>
                      {chainResult?.ok ? "Verified" : "Broken"}
                    </span>
                  </div>
                </div>
              </div>
              {!chainResult?.ok && chainResult?.reason && (
                <div id="errorBanner">{`Chain check failed at entry index ${chainResult.brokenAt}: ${chainResult.reason}`}</div>
              )}
              <table>
                <thead><tr><th>#</th><th>Event ref</th><th>Entry hash</th><th>Previous hash</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.sequenceNo}>
                      <td>{e.sequenceNo}</td>
                      <td className="mono">{e.eventRef}</td>
                      <td className="mono">{shortCid(e.entryHash)}</td>
                      <td className="mono">{e.previousHash ? shortCid(e.previousHash) : "(genesis)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section>
          <h2>Check your own statement</h2>
          <p className="trace">
            Paste the JSON statement you downloaded from the Investor page (or any object with the same
            fields: fund, holder, assetId, periodStart, periodEnd, currency, amount, sourceEventRef,
            dfnsTransferId). This page hashes it locally and checks whether it matches an entry above —
            your data never leaves your browser.
          </p>
          <textarea
            rows={8}
            placeholder='{"fund": "...", "holder": "...", "assetId": "...", "periodStart": "...", "periodEnd": "...", "currency": "OZM", "amount": "50000.0000000000", "sourceEventRef": "...", "dfnsTransferId": "..."}'
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
          />
          <div className="controls">
            <button type="button" onClick={checkStatement} disabled={checking || !statementText.trim()}>
              {checking ? "Checking…" : "Check against the proof log"}
            </button>
          </div>
          {checkResult && (
            <div id={checkResult.ok ? "noteBanner" : "errorBanner"}>
              {checkResult.message}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
