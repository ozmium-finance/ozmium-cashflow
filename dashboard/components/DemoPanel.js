import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setSetupField, setScenarioValue,
  setRunField, setRunStepDone, appendLog, resetRun, EMPTY_RUN,
} from "../store/demoSlice";
import { SCENARIOS } from "../lib/scenarios";
import { stepOrderFor, stepLabel } from "../lib/steps";
import { SETUP_TEMPLATES, PKG } from "../lib/stages";
import { money } from "../lib/format";
import {
  submitCommand, getOrAllocateParty, knownCidsFor, findNewContracts, createDfnsWallet,
} from "../lib/api";

// Strictly sequential within one scenario's run: exactly one button is
// ever clickable at a time -- the next step that hasn't been done yet.
// Every step, including "setup", is checked against this scenario's own
// run.stepDone -- each scenario shows its own checkbox for Setup too,
// even though the underlying parties/registry/holdings are reused
// across scenarios once any one of them has created them (stepSetup
// below is idempotent for exactly that reason).
function computeEnabledStep(runStepDone, hasParties, order) {
  for (const key of order) {
    if (runStepDone[key]) continue;
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
//
// Progress -- including Setup -- is scoped per scenario
// (demo.runs[scenarioValue]) so switching the dropdown never loses or
// locks out another scenario's progress. Only Setup's actual *output*
// (parties/registry/holdings ids) is shared across scenarios, since
// it's the same underlying ledger data regardless of which scenario
// happened to create it first.
export default function DemoPanel() {
  const dispatch = useDispatch();
  const demo = useSelector((s) => s.demo);
  const [runningKey, setRunningKey] = useState(null);

  const scenario = SCENARIOS[demo.scenarioValue];
  const order = stepOrderFor(scenario.kind);
  const run = demo.runs[demo.scenarioValue] || EMPTY_RUN;
  const enabledStep = computeEnabledStep(run.stepDone, !!demo.parties, order);
  const finished = run.stepDone[order[order.length - 1]];

  function log(text, isError) {
    dispatch(appendLog({ text, isError: !!isError }));
  }

  async function runStep(key, fn) {
    const scenarioKey = demo.scenarioValue;
    setRunningKey(key);
    try {
      await fn();
      dispatch(setRunStepDone({ scenario: scenarioKey, key }));
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
    // Only used by the token-vesting scenario (issuer of the OZM SAFT
    // AllocationTable), but allocated here too so Setup stays the one
    // step that seeds every party regardless of which scenario runs.
    const ozmiumIssuer = await getOrAllocateParty("OzmiumIssuer");
    const parties = { admin, propManager, berlinSpv, investor1, investor2, investor3, ozmiumIssuer };
    dispatch(setSetupField({ parties }));
    log("Parties ready: Admin, PropManagerCo, BerlinSPV, 3 investors, OzmiumIssuer");

    // Registry and holdings are the same for every scenario (one asset,
    // one 50/30/20 split), so -- like party allocation above -- reuse
    // whichever one's already on the ledger instead of creating a new
    // one every time a different scenario's own Setup step runs.
    const knownRegistry = await knownCidsFor(SETUP_TEMPLATES.registry);
    let registryCid = knownRegistry.size > 0 ? [...knownRegistry][0] : undefined;
    if (!registryCid) {
      await submitCommand(admin, [{
        CreateCommand: {
          templateId: `${PKG}:Ozmium.Validation:AttestorRegistry`,
          createArguments: {
            admin, fund: berlinSpv, assetId: "berlin-hauptstrasse-12", authorizedAttestor: propManager,
            // Licensed with a far-future expiry by default -- the point
            // of the attestor-licensing work is the Revoke/Renew choices
            // existing and being enforced by Attestation_Validate, not
            // making the demo's own attestor expire mid-click-through.
            licenseState: "Active",
            expiresOn: "2030-01-01",
          },
        },
      }]);
      const [registry] = await findNewContracts(SETUP_TEMPLATES.registry, knownRegistry);
      registryCid = registry?.contractId;
    }
    dispatch(setSetupField({ registryCid }));
    log("AttestorRegistry ready — PropManagerCo authorized for berlin-hauptstrasse-12");

    const knownHoldings = await knownCidsFor(SETUP_TEMPLATES.holdings);
    let holdingsCid = knownHoldings.size > 0 ? [...knownHoldings][0] : undefined;
    if (!holdingsCid) {
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
      holdingsCid = holdings?.contractId;
    }
    dispatch(setSetupField({ holdingsCid }));
    log("HoldingsSnapshot ready — 50/30/20 across Alice/Bob/Carol");
  }

  async function stepAttest() {
    const { propManager, berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = SCENARIOS[scenarioKey];

    const known = await knownCidsFor("Ozmium.Attestation:RevenueAttestation");
    await submitCommand(propManager, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        createArguments: {
          attestor: propManager, fund: berlinSpv, assetId: "berlin-hauptstrasse-12",
          revenueType: s.revenueType, periodStart: s.periodStart, periodEnd: s.periodEnd,
          grossAmount: s.grossAmount, currency: s.currency,
          deductions: s.deductions,
          sourceRef: `dashboard-demo-${scenarioKey}-${Date.now()}`,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Attestation:RevenueAttestation", known);

    const totalDeductions = s.deductions.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    const activeNet = parseFloat(s.grossAmount) - totalDeductions;
    dispatch(setRunField({ scenario: scenarioKey, fields: { attestationCid: created?.contractId, activeScenario: s, activeNet } }));
    log(`RevenueAttestation created — ${money(s.grossAmount, s.currency)} gross, ${s.periodStart} → ${s.periodEnd} (${s.label})`);
  }

  async function stepValidate() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.Validation:ValidatedRevenueEvent");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        contractId: run.attestationCid,
        choice: "Attestation_Validate",
        choiceArgument: { registryCid: demo.registryCid, knownPriorEventCids: [] },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Validation:ValidatedRevenueEvent", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { validatedCid: created?.contractId } }));
    log(`Validated — net operating income after deductions: ${money(run.activeNet, run.activeScenario.currency)}`);
  }

  async function stepDistribute() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Distribution:DistributionDecision");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Validation:ValidatedRevenueEvent`,
        contractId: run.validatedCid,
        choice: "ValidatedRevenueEvent_DecideDistribution",
        choiceArgument: { retentionAmount: s.retentionAmount, retentionReason: s.retentionReason },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Distribution:DistributionDecision", known);
    const activePassThrough = run.activeNet - parseFloat(s.retentionAmount);
    dispatch(setRunField({ scenario: scenarioKey, fields: { distributionCid: created?.contractId, activePassThrough } }));
    const retainMsg = parseFloat(s.retentionAmount) > 0
      ? `retains ${money(s.retentionAmount, s.currency)} (${s.retentionReason})`
      : "retains nothing — full pass-through";
    log(`SPV ${retainMsg} — ${money(activePassThrough, s.currency)} passes through`);
  }

  async function stepEntitlement() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Entitlement:EntitlementCalculation");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Distribution:DistributionDecision`,
        contractId: run.distributionCid,
        choice: "DistributionDecision_CalculateEntitlement",
        choiceArgument: { holdingsCid: demo.holdingsCid },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Entitlement:EntitlementCalculation", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { entitlementCid: created?.contractId, entitlementFund: berlinSpv } }));
    const pt = run.activePassThrough;
    log(`Entitlement split — Alice ${money(pt * 0.5, s.currency)} / Bob ${money(pt * 0.3, s.currency)} / Carol ${money(pt * 0.2, s.currency)}`);
  }

  // Mission 2's other entitlement basis: a static SAFT cap table
  // (AllocationTable) instead of the recurring waterfall -- no
  // attest/validate/distribute involved, just the issuer's own cap
  // table and vesting schedule.
  async function stepAllocate() {
    const { ozmiumIssuer } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = SCENARIOS[scenarioKey];

    const known = await knownCidsFor("Ozmium.Allocation:AllocationTable");
    await submitCommand(ozmiumIssuer, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Allocation:AllocationTable`,
        createArguments: {
          issuer: ozmiumIssuer,
          assetId: s.assetId,
          tokenSymbol: s.tokenSymbol,
          allocations: s.allocations.map((a) => ({ _1: demo.parties[a.holder], _2: a.amount })),
          schedule: {
            triggerDate: s.triggerDate,
            // Int, like Decimal, comes over the JSON API as a string --
            // sending the raw number here is what triggered the
            // "Expected ujson.Str (data: 730)" 500 on this step.
            cliffDays: String(s.cliffDays),
            vestingDays: String(s.vestingDays),
          },
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Allocation:AllocationTable", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { allocationCid: created?.contractId, activeScenario: s } }));
    log(`AllocationTable created — ${s.tokenSymbol} SAFT, ${s.allocations.length} holders, ${s.cliffDays}d cliff / ${s.vestingDays}d vest`);
  }

  // Exercises the nonconsuming AllocationTable_CalculateEntitlement
  // choice -- this is the new fixed/vesting math landing on the same
  // EntitlementCalculation shape the waterfall case produces.
  async function stepRelease() {
    const { ozmiumIssuer } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Entitlement:EntitlementCalculation");
    await submitCommand(ozmiumIssuer, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Allocation:AllocationTable`,
        contractId: run.allocationCid,
        choice: "AllocationTable_CalculateEntitlement",
        choiceArgument: {
          asOfDate: s.asOfDate,
          previouslyReleased: [],
          sourceRef: `dashboard-demo-${scenarioKey}-${Date.now()}`,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Entitlement:EntitlementCalculation", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { entitlementCid: created?.contractId, entitlementFund: ozmiumIssuer } }));
    log(`Vested entitlement calculated as of ${s.asOfDate} — fixed/vesting basis, ${s.cliffDays}d cliff already passed, partway through the ${s.vestingDays}d vest`);
  }

  // Shared by both scenario kinds: EntitlementCalculation_Settle doesn't
  // care whether `fund` is BerlinSPV (waterfall) or OzmiumIssuer
  // (vesting), so this reads whichever party this run's entitlementFund
  // records from the step that created the entitlement.
  async function stepSettle() {
    const scenarioKey = demo.scenarioValue;
    const { entitlementFund } = run;
    const known = await knownCidsFor("Ozmium.Settlement:SettlementInstruction");
    await submitCommand(entitlementFund, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Entitlement:EntitlementCalculation`,
        contractId: run.entitlementCid,
        choice: "EntitlementCalculation_Settle",
        choiceArgument: {},
      },
    }]);
    const created = await findNewContracts("Ozmium.Settlement:SettlementInstruction", known);
    const settlementCids = created.map((ev) => ev.contractId);
    // allSettlementCids is the full set, kept around for the report
    // steps below -- settlementCids itself gets drained to nothing by
    // markNextSettlementPaid as each one gets marked Paid.
    dispatch(setRunField({ scenario: scenarioKey, fields: { settlementCids, allSettlementCids: settlementCids } }));
    log(`${created.length} settlement instruction(s) created — pending payment`);
  }

  // Marks whichever settlement is still first in run.settlementCids as
  // Paid, then drops it -- calling this repeatedly (steps 7/8/9 for the
  // waterfall's 3 investors, or 4/5 for the vesting scenario's 2) walks
  // through each holder one at a time.
  async function markNextSettlementPaid(ordinal) {
    const scenarioKey = demo.scenarioValue;
    const { entitlementFund } = run;
    const cid = run.settlementCids[0];
    // Settlement_MarkPaid is consuming -- it archives `cid` and creates
    // a new contract (new id) in Paid status. allSettlementCids has to
    // track that replacement, not just the original Pending id, since
    // the report step later fetches whatever's in allSettlementCids and
    // that original id won't exist on the ledger anymore by then. This
    // is exactly the bug that produced a CONTRACT_NOT_FOUND on Finalize
    // before this fix -- allSettlementCids was never updated here, so
    // it kept pointing at three already-archived Pending contracts.
    const known = await knownCidsFor("Ozmium.Settlement:SettlementInstruction");
    await submitCommand(entitlementFund, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Settlement:SettlementInstruction`,
        contractId: cid,
        choice: "Settlement_MarkPaid",
        choiceArgument: {},
      },
    }]);
    const [paid] = await findNewContracts("Ozmium.Settlement:SettlementInstruction", known);
    if (!paid?.contractId) {
      throw new Error("Settlement_MarkPaid succeeded but the resulting Paid contract couldn't be found afterward");
    }
    dispatch(setRunField({
      scenario: scenarioKey,
      fields: {
        settlementCids: run.settlementCids.filter((c) => c !== cid),
        allSettlementCids: run.allSettlementCids.map((c) => (c === cid ? paid.contractId : c)),
      },
    }));
    log(`${ordinal} settlement marked Paid`);
  }

  // Week 3: roll every settlement this run produced into an on-ledger
  // report. Draft/Finalize is two steps on the ledger (see
  // Ozmium.Reporting) so Finalize has somewhere to fetch and check each
  // settlement's actual status rather than trusting whatever this
  // client claims -- worth showing as two separate buttons here too,
  // rather than collapsing them, so the verification step is visible as
  // its own moment in the click-through.
  async function stepDraftReport() {
    const scenarioKey = demo.scenarioValue;
    const { entitlementFund } = run;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Reporting:DistributionReportDraft");
    await submitCommand(entitlementFund, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Reporting:DistributionReportDraft`,
        createArguments: {
          fund: entitlementFund,
          assetId: "berlin-hauptstrasse-12",
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Reporting:DistributionReportDraft", known);
    if (!created?.contractId) {
      throw new Error("DistributionReportDraft was created but couldn't be found afterward");
    }
    dispatch(setRunField({ scenario: scenarioKey, fields: { reportDraftCid: created.contractId } }));
    log(`Report draft opened for ${s.periodStart} → ${s.periodEnd}`);
  }

  async function stepFinalizeReport() {
    const scenarioKey = demo.scenarioValue;
    const { entitlementFund } = run;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Reporting:DistributionReport");
    await submitCommand(entitlementFund, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Reporting:DistributionReportDraft`,
        contractId: run.reportDraftCid,
        choice: "DistributionReportDraft_Finalize",
        choiceArgument: {
          settlementCids: run.allSettlementCids,
          generatedOn: s.reportGeneratedOn,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Reporting:DistributionReport", known);
    if (!created?.contractId) {
      throw new Error("DistributionReport was created but couldn't be found afterward");
    }
    dispatch(setRunField({ scenario: scenarioKey, fields: { reportCid: created.contractId } }));
    log(`Report finalized — ${run.allSettlementCids.length} Paid settlement(s) fetched, verified, and summarized`);
  }

  // Attestor licensing demo: same registry/attestor Setup already
  // creates, walked through Active -> works -> Revoked -> rejected ->
  // Renewed -> works again. registryCid is genuinely global/shared
  // state (every scenario's validate step reads demo.registryCid), so
  // revoke/renew below update it at the top level via setSetupField,
  // not just this run -- Revoke/Renew are consuming choices, so the
  // registry's contract id changes every time either fires, and every
  // other scenario needs to keep seeing the current one.
  async function stepAttestFirst() {
    const { propManager, berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = SCENARIOS[scenarioKey];
    const period = s.periods[0];

    const known = await knownCidsFor("Ozmium.Attestation:RevenueAttestation");
    await submitCommand(propManager, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        createArguments: {
          attestor: propManager, fund: berlinSpv, assetId: "berlin-hauptstrasse-12",
          revenueType: s.revenueType, periodStart: period.periodStart, periodEnd: period.periodEnd,
          grossAmount: period.grossAmount, currency: period.currency,
          deductions: period.deductions,
          sourceRef: `dashboard-demo-${scenarioKey}-first-${Date.now()}`,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Attestation:RevenueAttestation", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { firstAttestationCid: created?.contractId, activeScenario: s } }));
    log(`First attestation created — ${period.periodStart} → ${period.periodEnd} — PropManagerCo is currently licensed`);
  }

  async function stepValidateFirst() {
    const { berlinSpv } = demo.parties;
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        contractId: run.firstAttestationCid,
        choice: "Attestation_Validate",
        choiceArgument: { registryCid: demo.registryCid, knownPriorEventCids: [] },
      },
    }]);
    log("Validated — PropManagerCo's license is Active, attestation accepted normally");
  }

  async function stepRevoke() {
    const { admin } = demo.parties;
    const known = await knownCidsFor("Ozmium.Validation:AttestorRegistry");
    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Validation:AttestorRegistry`,
        contractId: demo.registryCid,
        choice: "AttestorRegistry_Revoke",
        choiceArgument: {},
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Validation:AttestorRegistry", known);
    dispatch(setSetupField({ registryCid: created?.contractId }));
    log("PropManagerCo's license revoked — any attestation validated from now on will be rejected");
  }

  async function stepAttestSecond() {
    const { propManager, berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const period = s.periods[1];

    const known = await knownCidsFor("Ozmium.Attestation:RevenueAttestation");
    await submitCommand(propManager, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        createArguments: {
          attestor: propManager, fund: berlinSpv, assetId: "berlin-hauptstrasse-12",
          revenueType: s.revenueType, periodStart: period.periodStart, periodEnd: period.periodEnd,
          grossAmount: period.grossAmount, currency: period.currency,
          deductions: period.deductions,
          sourceRef: `dashboard-demo-${scenarioKey}-second-${Date.now()}`,
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Attestation:RevenueAttestation", known);
    dispatch(setRunField({ scenario: scenarioKey, fields: { secondAttestationCid: created?.contractId } }));
    log(`Second attestation created — ${period.periodStart} → ${period.periodEnd} — same attestor, now revoked`);
  }

  // The interesting outcome here is the rejection itself -- so unlike
  // every other step, a thrown error from the ledger is the expected,
  // "this worked correctly" path. If the exercise instead succeeds,
  // that's the real bug (a revoked attestor got through), so this
  // throws in that case to surface it as a failure the normal way.
  async function stepValidateRejected() {
    const { berlinSpv } = demo.parties;
    try {
      await submitCommand(berlinSpv, [{
        ExerciseCommand: {
          templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
          contractId: run.secondAttestationCid,
          choice: "Attestation_Validate",
          choiceArgument: { registryCid: demo.registryCid, knownPriorEventCids: [] },
        },
      }]);
    } catch (err) {
      log("Validation correctly rejected — PropManagerCo's license is currently Revoked");
      return;
    }
    throw new Error("Validation unexpectedly succeeded — a revoked attestor should have been rejected");
  }

  async function stepRenew() {
    const { admin } = demo.parties;
    const s = run.activeScenario;
    const known = await knownCidsFor("Ozmium.Validation:AttestorRegistry");
    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Validation:AttestorRegistry`,
        contractId: demo.registryCid,
        choice: "AttestorRegistry_Renew",
        choiceArgument: { newExpiresOn: s.renewedExpiresOn },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Validation:AttestorRegistry", known);
    dispatch(setSetupField({ registryCid: created?.contractId }));
    log(`PropManagerCo re-licensed through ${s.renewedExpiresOn} — back to Active`);
  }

  async function stepValidateRenewed() {
    const { berlinSpv } = demo.parties;
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Attestation:RevenueAttestation`,
        contractId: run.secondAttestationCid,
        choice: "Attestation_Validate",
        choiceArgument: { registryCid: demo.registryCid, knownPriorEventCids: [] },
      },
    }]);
    log("Validated — PropManagerCo is Active again after renewal, second attestation now accepted");
  }

  // Investor onboarding demo, reworked per Alex's direction to actually
  // follow DA Registry's self-onboarding shape: the investor proposes
  // their own onboarding (not admin registering them unilaterally), and
  // admin's Approve/Reject choice on that request is what *creates* the
  // InvestorCredential -- there's no separate "Pending" contract state
  // to track, the request's existence on the ledger already is that.
  // Two investors run through it in parallel with opposite outcomes:
  // Alice's request gets Approved and her subscription goes through;
  // Bob's gets Rejected and his subscription request -- which looks
  // exactly as valid as Alice's on its face -- gets turned away at
  // Accept anyway. berlinSpv plays `issuer`/`fund` here, same as
  // everywhere else; `admin` is Setup's own Admin party, the same one
  // that controls AttestorRegistry.
  async function stepRequestOnboarding1() {
    const { admin, berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = SCENARIOS[scenarioKey];
    const investor = demo.parties[s.approvedInvestor];

    const known = await knownCidsFor("Ozmium.Investor:InvestorOnboardingRequest");
    await submitCommand(investor, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Investor:InvestorOnboardingRequest`,
        createArguments: {
          investor, fund: berlinSpv, admin,
          submittedOn: "2026-08-01",
          applicationNotes: "",
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Investor:InvestorOnboardingRequest", known);
    if (!created?.contractId) throw new Error("InvestorOnboardingRequest was created but couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor1RequestCid: created.contractId, activeScenario: s } }));
    log("Alice proposes onboarding — awaiting admin review");
  }

  async function stepApproveOnboarding1() {
    const { admin } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.Investor:InvestorCredential");
    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Investor:InvestorOnboardingRequest`,
        contractId: run.investor1RequestCid,
        choice: "InvestorOnboardingRequest_Approve",
        choiceArgument: { effectiveOn: "2026-08-02", notes: "KYC cleared" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Investor:InvestorCredential", known);
    if (!created?.contractId) throw new Error("InvestorOnboardingRequest_Approve succeeded but the credential couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor1CredentialCid: created.contractId } }));
    log("Alice's onboarding approved — InvestorCredential issued (Approved)");
  }

  async function stepRequestSubscription1() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const investor = demo.parties[s.approvedInvestor];

    const known = await knownCidsFor("Ozmium.Subscription:SubscriptionRequest");
    await submitCommand(investor, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Subscription:SubscriptionRequest`,
        createArguments: {
          investor, issuer: berlinSpv, assetId: s.assetId,
          requestedAmount: s.approvedAmount, currency: s.currency,
          submittedOn: "2026-08-03",
          status: "SubscriptionRequested",
          reviewNotes: "",
          lastUpdatedOn: "2026-08-03",
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Subscription:SubscriptionRequest", known);
    if (!created?.contractId) throw new Error("SubscriptionRequest was created but couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { subscription1Cid: created.contractId } }));
    log(`Alice requests a subscription for ${money(s.approvedAmount, s.currency)}`);
  }

  async function stepAcceptSubscription1() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.Subscription:SubscriptionRequest");
    await submitCommand(berlinSpv, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Subscription:SubscriptionRequest`,
        contractId: run.subscription1Cid,
        choice: "SubscriptionRequest_Accept",
        choiceArgument: { credentialCid: run.investor1CredentialCid, effectiveOn: "2026-08-04" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Subscription:SubscriptionRequest", known);
    if (!created?.contractId) throw new Error("SubscriptionRequest_Accept succeeded but the result couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { subscription1Cid: created.contractId } }));
    log("Alice's subscription accepted — her credential is Approved, so this went through cleanly");
  }

  async function stepRequestOnboarding2() {
    const { admin, berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const investor = demo.parties[s.rejectedInvestor];

    const known = await knownCidsFor("Ozmium.Investor:InvestorOnboardingRequest");
    await submitCommand(investor, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Investor:InvestorOnboardingRequest`,
        createArguments: {
          investor, fund: berlinSpv, admin,
          submittedOn: "2026-08-01",
          applicationNotes: "",
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Investor:InvestorOnboardingRequest", known);
    if (!created?.contractId) throw new Error("InvestorOnboardingRequest was created but couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor2RequestCid: created.contractId } }));
    log("Bob proposes onboarding — awaiting admin review");
  }

  async function stepRejectOnboarding2() {
    const { admin } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.Investor:InvestorCredential");
    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Investor:InvestorOnboardingRequest`,
        contractId: run.investor2RequestCid,
        choice: "InvestorOnboardingRequest_Reject",
        choiceArgument: { effectiveOn: "2026-08-02", notes: "Failed sanctions screening" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Investor:InvestorCredential", known);
    if (!created?.contractId) throw new Error("InvestorOnboardingRequest_Reject succeeded but the credential couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor2CredentialCid: created.contractId } }));
    log("Bob's onboarding rejected — InvestorCredential issued (Rejected)");
  }

  async function stepRequestSubscription2() {
    const { berlinSpv } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const s = run.activeScenario;
    const investor = demo.parties[s.rejectedInvestor];

    const known = await knownCidsFor("Ozmium.Subscription:SubscriptionRequest");
    await submitCommand(investor, [{
      CreateCommand: {
        templateId: `${PKG}:Ozmium.Subscription:SubscriptionRequest`,
        createArguments: {
          investor, issuer: berlinSpv, assetId: s.assetId,
          requestedAmount: s.rejectedAmount, currency: s.currency,
          submittedOn: "2026-08-03",
          status: "SubscriptionRequested",
          reviewNotes: "",
          lastUpdatedOn: "2026-08-03",
        },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.Subscription:SubscriptionRequest", known);
    if (!created?.contractId) throw new Error("SubscriptionRequest was created but couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { subscription2Cid: created.contractId } }));
    log(`Bob requests a subscription for ${money(s.rejectedAmount, s.currency)} — looks identical to Alice's request`);
  }

  // Same inverted-catch shape as stepValidateRejected in the licensing
  // scenario: the rejection itself is the expected, correct outcome
  // here, so catching it is the success path. If Accept unexpectedly
  // succeeds instead, that's the real bug (a rejected investor got
  // through), so this throws in that case to surface it as a failure.
  async function stepAcceptSubscription2Rejected() {
    const { berlinSpv } = demo.parties;
    try {
      await submitCommand(berlinSpv, [{
        ExerciseCommand: {
          templateId: `${PKG}:Ozmium.Subscription:SubscriptionRequest`,
          contractId: run.subscription2Cid,
          choice: "SubscriptionRequest_Accept",
          choiceArgument: { credentialCid: run.investor2CredentialCid, effectiveOn: "2026-08-04" },
        },
      }]);
    } catch (err) {
      log("Correctly rejected — Bob's KYC status is Rejected, not Approved");
      return;
    }
    throw new Error("Subscription unexpectedly accepted — a rejected investor should have been turned away");
  }

  // CIP-56/DFNS groundwork -- the AddressBook Identity Mapper. First
  // creates a *real* DFNS-custodied wallet on CantonTestnet (via the
  // service account wired up in lib/dfnsServer.js), tagged with Alice's
  // actual Canton PartyID as its externalId, then links Alice's
  // already-Approved credential to that real wallet id via the choice on
  // InvestorCredential itself (see Ozmium.Investor) -- same "choice on
  // the gating contract, not a bare create" shape SubscriptionRequest_Accept
  // uses. No more manually-typed placeholder wallet id: this is the live
  // DFNS API in the loop, not a stand-in for it.
  async function stepLinkWallet1() {
    const { admin, investor1 } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.AddressBook:AddressBookEntry");

    const wallet = await createDfnsWallet("ozmium-investor-alice", investor1);
    if (!wallet?.id) throw new Error("DFNS wallet creation succeeded but returned no wallet id");
    log(`DFNS wallet created — ${wallet.id} (${wallet.network}), address ${wallet.address}`);

    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.Investor:InvestorCredential`,
        contractId: run.investor1CredentialCid,
        choice: "InvestorCredential_LinkDfnsWallet",
        choiceArgument: { effectiveOn: "2026-08-05", dfnsWalletId: wallet.id, linkNotes: "Initial link" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.AddressBook:AddressBookEntry", known);
    if (!created?.contractId) throw new Error("InvestorCredential_LinkDfnsWallet succeeded but the AddressBookEntry couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor1AddressBookCid: created.contractId } }));
    log(`Alice's Canton PartyID linked to real DFNS wallet ${wallet.id}`);
  }

  // Same inverted-catch shape as stepAcceptSubscription2Rejected: Bob's
  // credential is Rejected, so the interesting outcome here is the
  // rejection itself. If the link unexpectedly succeeds, that's the real
  // bug (a non-Approved investor got a wallet mapping), so this throws
  // in that case to surface it as a failure the normal way.
  async function stepLinkWallet2Rejected() {
    const { admin } = demo.parties;
    try {
      await submitCommand(admin, [{
        ExerciseCommand: {
          templateId: `${PKG}:Ozmium.Investor:InvestorCredential`,
          contractId: run.investor2CredentialCid,
          choice: "InvestorCredential_LinkDfnsWallet",
          choiceArgument: { effectiveOn: "2026-08-05", dfnsWalletId: "dfns-wallet-bob-001", linkNotes: "Should not go through" },
        },
      }]);
    } catch (err) {
      log("Correctly rejected — Bob's credential isn't Approved, so no wallet mapping can be created");
      return;
    }
    throw new Error("Link unexpectedly succeeded — a non-Approved investor should never get a DFNS wallet mapping");
  }

  async function stepUnlinkWallet1() {
    const { admin } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.AddressBook:AddressBookEntry");
    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.AddressBook:AddressBookEntry`,
        contractId: run.investor1AddressBookCid,
        choice: "AddressBookEntry_Unlink",
        choiceArgument: { effectiveOn: "2026-08-06", unlinkNotes: "Wallet flagged for rotation" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.AddressBook:AddressBookEntry", known);
    if (!created?.contractId) throw new Error("AddressBookEntry_Unlink succeeded but the result couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor1AddressBookCid: created.contractId } }));
    log("Alice's wallet mapping unlinked");
  }

  // Rotation, for real: creates a *second* real DFNS wallet (simulating
  // "the old one needs replacing") and relinks to that new real wallet
  // id, rather than swapping in another placeholder string.
  async function stepRelinkWallet1() {
    const { admin, investor1 } = demo.parties;
    const scenarioKey = demo.scenarioValue;
    const known = await knownCidsFor("Ozmium.AddressBook:AddressBookEntry");

    const wallet = await createDfnsWallet("ozmium-investor-alice-rotated", investor1);
    if (!wallet?.id) throw new Error("DFNS wallet creation succeeded but returned no wallet id");
    log(`New DFNS wallet created for rotation — ${wallet.id} (${wallet.network}), address ${wallet.address}`);

    await submitCommand(admin, [{
      ExerciseCommand: {
        templateId: `${PKG}:Ozmium.AddressBook:AddressBookEntry`,
        contractId: run.investor1AddressBookCid,
        choice: "AddressBookEntry_Relink",
        choiceArgument: { effectiveOn: "2026-08-07", newDfnsWalletId: wallet.id, relinkNotes: "Rotated to new wallet" },
      },
    }]);
    const [created] = await findNewContracts("Ozmium.AddressBook:AddressBookEntry", known);
    if (!created?.contractId) throw new Error("AddressBookEntry_Relink succeeded but the result couldn't be found afterward");
    dispatch(setRunField({ scenario: scenarioKey, fields: { investor1AddressBookCid: created.contractId } }));
    log(`Alice's wallet mapping relinked to real DFNS wallet ${wallet.id}`);
  }

  const STEP_FN = {
    setup: stepSetup,
    attest: stepAttest,
    validate: stepValidate,
    distribute: stepDistribute,
    entitlement: stepEntitlement,
    allocate: stepAllocate,
    release: stepRelease,
    settle: stepSettle,
    markPaid: () => markNextSettlementPaid("First"),
    markPaid2: () => markNextSettlementPaid("Second"),
    markPaid3: () => markNextSettlementPaid("Third"),
    attestFirst: stepAttestFirst,
    validateFirst: stepValidateFirst,
    revoke: stepRevoke,
    attestSecond: stepAttestSecond,
    validateRejected: stepValidateRejected,
    renew: stepRenew,
    validateRenewed: stepValidateRenewed,
    draftReport: stepDraftReport,
    finalizeReport: stepFinalizeReport,
    requestOnboarding1: stepRequestOnboarding1,
    approveOnboarding1: stepApproveOnboarding1,
    requestSubscription1: stepRequestSubscription1,
    acceptSubscription1: stepAcceptSubscription1,
    requestOnboarding2: stepRequestOnboarding2,
    rejectOnboarding2: stepRejectOnboarding2,
    requestSubscription2: stepRequestSubscription2,
    acceptSubscription2Rejected: stepAcceptSubscription2Rejected,
    linkWallet1: stepLinkWallet1,
    linkWallet2Rejected: stepLinkWallet2Rejected,
    unlinkWallet1: stepUnlinkWallet1,
    relinkWallet1: stepRelinkWallet1,
  };

  return (
    <div id="demoPanel">
      <div className="demo-title">Demo controls — click through the workflow instead of running dpm script</div>
      <div className="demo-steps">
        <select
          value={demo.scenarioValue}
          disabled={runningKey !== null}
          onChange={(e) => dispatch(setScenarioValue(e.target.value))}
        >
          {Object.entries(SCENARIOS).map(([key, s]) => (
            <option key={key} value={key}>Scenario: {s.label}</option>
          ))}
        </select>
        {order.map((key) => {
          const done = run.stepDone[key];
          const isWorking = runningKey === key;
          const isEnabled = key === enabledStep && runningKey === null;
          return (
            <button
              key={key}
              disabled={done || !isEnabled}
              className={done ? "demo-done" : ""}
              onClick={() => runStep(key, STEP_FN[key])}
            >
              {done ? "✓ " : ""}{isWorking ? "Working…" : stepLabel(scenario.kind, key)}
            </button>
          );
        })}
        {finished && (
          <button className="demo-restart" onClick={() => dispatch(resetRun(demo.scenarioValue))}>
            ↻ Run this scenario again
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
