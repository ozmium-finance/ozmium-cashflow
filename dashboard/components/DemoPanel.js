import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setField, setStepDone, setScenarioValue, appendLog, resetForNewScenario,
} from "../store/demoSlice";
import { SCENARIOS } from "../lib/scenarios";
import { STEP_ORDER, STEP_BTN_LABEL } from "../lib/steps";
import { SETUP_TEMPLATES, PKG } from "../lib/stages";
import { money } from "../lib/format";
import {
  submitCommand, getOrAllocateParty, knownCidsFor, findNewContracts,
} from "../lib/api";

// Strictly sequential: exactly one button is ever clickable at a time --
// the next step that hasn't been done yet. Completed steps stay disabled
// permanently (shown with a checkmark) so the workflow can't be run out
// of order or re-triggered by accident.
function computeEnabledStep(stepDone, hasParties) {
  for (const key of STEP_ORDER) {
    if (stepDone[key]) continue;
    if (key !== "setup" && !hasParties) return null;
    return key;
  }
  return null;
}

// Drives the same workflow Ozmium.Demo:runFullDemo does, but from button
// clicks instead of the command line -- real commands against the JSON
// API v2 (POST /v2/commands/submit-and-wait), same template IDs and
// choice arguments as the actual Daml templates. submit-and-wait only
// returns an updateId/completionOffset, not the created contract's id,
// so each step re-queries active contracts afterward and diffs against
// what it already knew about to find the new one.
export default function DemoPanel() {
  const dispatch = useDispatch();
  const demo = useSelector((s) => s.demo);
  const [runningKey, setRunningKey] = useState(null);

  const enabledStep = computeEnabledStep(demo.stepDone, !!demo.parties);
  const finished = demo.stepDone.markPaid3;

  function log(text, isError) {
    dispatch(appendLog({ text, isError: !!isError }));
  }

  async function runStep(key, fn) {
    setRunningKey(key);
    try {
      await fn();
      dispatch(setStepDone(key));
    } catch (err) {
      log(err.message.split("\n")[0], true);
    } finally {
      setRunningKey(null);
    }
  }

  async function stepSetup() {
    const admin = await getOrAllocateParty("Admin");
    const propManager = await getOrAllocateParty("PropManagerCo");
    const berlinSpv = await getOrAllocateParty("BerlinSPV");
    const investor1 = await getOrAllocateParty("InvestorAlice");
    const investor2 = await getOrAllocateParty("InvestorBob");
    const investor3 = await getOrAllocateParty("InvestorCarol");
    const parties = { admin, propManager, berlinSpv, investor1, investor2, investor3 };
    dispatch(setField({ parties }));
    log("Parties ready: Admin, PropManagerCo, BerlinSPV, 3 investors");

    const knownRegistry = await knownCidsFor(SETUP_TEMPLATES.registry);
    await submitCommand(admin, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Validation:AttestorRegistry`,
        createArguments: { admin, fund: berlinSpv, assetId: "berlin-hauptstrasse-12", authorizedAttestor: propManager },
      },
    }]);
    const [registry] = await findNewContracts(SETUP_TEMPLATES.registry, knownRegistry);
    dispatch(setField({ registryCid: registry?.contractId }));
    log("AttestorRegistry created — PropManagerCo authorized for berlin-hauptstrasse-12");

    const knownHoldings = await knownCidsFor(SETUP_TEMPLATES.holdings);
    await submitCommand(berlinSpv, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Entitlement:HoldingsSnapshot`,
        createArguments: {
          fund: berlinSpv, assetId: "berlin-hauptstrasse-12",
          holdings: [
            { _1: investor1, _2: "0.50" },
            { _1: investor2, _2: "0.30" },
            { _1: investor3, _2: "0.20" },
          ],
        },
      },
    }]);
    const [holdings] = await findNewContracts(SETUP_TEMPLATES.holdings, knownHoldings);
    dispatch(setField({ holdingsCid: holdings?.contractId }));
    log("HoldingsSnapshot created — 50/30/20 across Alice/Bob/Carol");
  }

  async function stepAttest() {
    const { propManager, berlinSpv } = demo.parties;
    const scenario = SCENARIOS[demo.scenarioValue];

    const known = await knownCidsFor("Ozmium.Attestation:RevenueAttestation");
    await submitCommand(propManager, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        createArguments: {
          attestor: propManager, fund: berlinSpv, assetId: "berlin-hauptstrasse-12",
          revenueType: scenario.revenueType, periodStart: scenario.periodStart, periodEnd: scenario.periodEnd,
          grossAmount: scenario.grossAmount, currency: scenario.currency,
          deductions: scenario.deductions,
          sourceRef: `dashboard-demo-${demo.scenarioValue}-${Date.now()}`,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Attestation:RevenueAttestation", known);

    const totalDeductions = scenario.deductions.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    const activeNet = parseFloat(scenario.grossAmount) - totalDeductions;
    dispatch(setField({ attestationCid: created?.contractId, activeScenario: scenario, activeNet }));
    log(`RevenueAttestation created — ${money(scenario.grossAmount, scenario.currency)} gross, ${scenario.periodStart} → ${scenario.periodEnd} (${scenario.label})`);
  }

  async function stepValidate() {
    const { berlinSpv } = demo.parties;
    const known = await knownCidsFor("Ozmium.Validation:ValidatedRevenueEvent");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        contractId: demo.attestationCid,
        choice: "Attestation_Validate",
        choiceArgument: { registryCid: demo.registryCid, knownPriorEventCids: [] },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Validation:ValidatedRevenueEvent", known);
    dispatch(setField({ validatedCid: created?.contractId }));
    log(`Validated — net operating income after deductions: ${money(demo.activeNet, demo.activeScenario.currency)}`);
  }

  async function stepDistribute() {
    const { berlinSpv } = demo.parties;
    const scenario = demo.activeScenario;
    const known = await knownCidsFor("Ozmium.Distribution:DistributionDecision");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Validation:ValidatedRevenueEvent`,
        contractId: demo.validatedCid,
        choice: "ValidatedRevenueEvent_DecideDistribution",
        choiceArgument: { retentionAmount: scenario.retentionAmount, retentionReason: scenario.retentionReason },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Distribution:DistributionDecision", known);
    const activePassThrough = demo.activeNet - parseFloat(scenario.retentionAmount);
    dispatch(setField({ distributionCid: created?.contractId, activePassThrough }));
    const retainMsg = parseFloat(scenario.retentionAmount) > 0
      ? `retains ${money(scenario.retentionAmount, scenario.currency)} (${scenario.retentionReason})`
      : "retains nothing — full pass-through";
    log(`SPV ${retainMsg} — ${money(activePassThrough, scenario.currency)} passes through`);
  }

  async function stepEntitlement() {
    const { berlinSpv } = demo.parties;
    const scenario = demo.activeScenario;
    const known = await knownCidsFor("Ozmium.Entitlement:EntitlementCalculation");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Distribution:DistributionDecision`,
        contractId: demo.distributionCid,
        choice: "DistributionDecision_CalculateEntitlement",
        choiceArgument: { holdingsCid: demo.holdingsCid },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Entitlement:EntitlementCalculation", known);
    dispatch(setField({ entitlementCid: created?.contractId }));
    const pt = demo.activePassThrough;
    log(`Entitlement split — Alice ${money(pt * 0.5, scenario.currency)} / Bob ${money(pt * 0.3, scenario.currency)} / Carol ${money(pt * 0.2, scenario.currency)}`);
  }

  async function stepSettle() {
    const { berlinSpv } = demo.parties;
    const known = await knownCidsFor("Ozmium.Settlement:SettlementInstruction");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Entitlement:EntitlementCalculation`,
        contractId: demo.entitlementCid,
        choice: "EntitlementCalculation_Settle",
        choiceArgument: {},
      },
    }]);
    const created = await findNewContracts("Ozmium.Settlement:SettlementInstruction", known);
    dispatch(setField({ settlementCids: created.map((ev) => ev.contractId) }));
    log(`${created.length} settlement instruction(s) created — pending payment`);
  }

  // Marks whichever settlement is still first in demo.settlementCids as
  // Paid, then drops it -- calling this three times in a row (steps
  // 7/8/9) walks through all three investors one at a time.
  async function markNextSettlementPaid(ordinal) {
    const { berlinSpv } = demo.parties;
    const cid = demo.settlementCids[0];
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Settlement:SettlementInstruction`,
        contractId: cid,
        choice: "Settlement_MarkPaid",
        choiceArgument: {},
      },
    }]);
    dispatch(setField({ settlementCids: demo.settlementCids.filter((c) => c !== cid) }));
    log(`${ordinal} settlement marked Paid`);
  }

  const STEP_FN = {
    setup: stepSetup,
    attest: stepAttest,
    validate: stepValidate,
    distribute: stepDistribute,
    entitlement: stepEntitlement,
    settle: stepSettle,
    markPaid: () => markNextSettlementPaid("First"),
    markPaid2: () => markNextSettlementPaid("Second"),
    markPaid3: () => markNextSettlementPaid("Third"),
  };

  return (
    <div id="demoPanel">
      <div className="demo-title">Demo controls — click through the workflow instead of running dpm script</div>
      <div className="demo-steps">
        <select
          value={demo.scenarioValue}
          disabled={demo.stepDone.attest && !finished}
          onChange={(e) => dispatch(setScenarioValue(e.target.value))}
        >
          {Object.entries(SCENARIOS).map(([key, s]) => (
            <option key={key} value={key}>Scenario: {s.label}</option>
          ))}
        </select>
        {STEP_ORDER.map((key) => {
          const done = demo.stepDone[key];
          const isWorking = runningKey === key;
          const isEnabled = key === enabledStep && runningKey === null;
          return (
            <button
              key={key}
              disabled={done || !isEnabled}
              className={done ? "demo-done" : ""}
              onClick={() => runStep(key, STEP_FN[key])}
            >
              {done ? "✓ " : ""}{isWorking ? "Working…" : STEP_BTN_LABEL[key]}
            </button>
          );
        })}
        {finished && (
          <button className="demo-restart" onClick={() => dispatch(resetForNewScenario())}>
            ↻ Run another scenario
          </button>
        )}
      </div>
      <div id="demoLog">
        {demo.log.map((entry) => (
          <div key={entry.id} className={entry.isError ? "demo-log-err" : "demo-log-ok"}>
            {entry.isError ? "✗ " : "✓ "}{entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}
