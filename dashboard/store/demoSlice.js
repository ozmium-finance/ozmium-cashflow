import { createSlice } from "@reduxjs/toolkit";

// Every scenario tracks its own progress independently, including its
// own "1. Setup" checkbox -- switching the dropdown never loses or
// locks out another scenario's progress, and each scenario shows its
// own steps as not-yet-done until you actually click through them
// there, even if Setup's underlying output (parties, registry,
// holdings) already exists from having run it under a different
// scenario first.
//
// That's safe to do because Setup itself is idempotent -- party
// allocation already reused existing parties by hint, and DemoPanel's
// stepSetup now does the same for AttestorRegistry/HoldingsSnapshot -- so
// clicking "1. Setup" again under a second scenario just confirms
// what's already there and marks that scenario's own checkbox, instead
// of spawning duplicate contracts.
function emptyRun() {
  return {
    attestationCid: null,
    validatedCid: null,
    distributionCid: null,
    allocationCid: null,
    entitlementCid: null,
    // Whichever party is `fund` on this run's EntitlementCalculation --
    // BerlinSPV for the waterfall chain, OzmiumIssuer for the vesting
    // chain -- since that's who's authorized to Settle/MarkPaid, and it
    // differs by scenario kind.
    entitlementFund: null,
    settlementCids: null,
    // settlementCids gets drained as each markPaid* step pops one off
    // (see markNextSettlementPaid below) -- this keeps the full original
    // set around too, since the reporting step needs every settlement
    // this run produced, not just whatever's still unpaid.
    allSettlementCids: null,
    reportDraftCid: null,
    reportCid: null,
    // Week 6 -- Ozmium.ProofLog. proofLogCid is the running anchor
    // (replaced on every append, same "consuming choice recreates the
    // contract" shape as settlementCids above), proofEntryCids
    // accumulates every entry this run has appended so far, in order --
    // both only ever populated for the vesting scenario today (see
    // stepCreateProofLog/markNextSettlementPaid in DemoPanel.js).
    proofLogCid: null,
    proofEntryCids: null,
    // Only used by the attestor-licensing scenario -- two separate
    // RevenueAttestations (before and after the revoke/renew cycle),
    // kept as distinct fields since both are alive across several
    // steps at once (unlike the waterfall/vesting chains, which only
    // ever have one attestation-shaped contract in flight).
    firstAttestationCid: null,
    secondAttestationCid: null,
    // Only used by the investor-onboarding scenario -- Alice's and
    // Bob's onboarding/credential/subscription contracts, kept as
    // distinct fields for the same reason as above: both investors'
    // contracts are alive across the run at once, not sequential like
    // the waterfall chain's single attestation-at-a-time shape.
    // Request and Credential are two separate cids per investor now
    // (propose-accept), not one recreated contract -- approving a
    // request *creates* the credential, it doesn't just relabel the
    // request.
    investor1RequestCid: null,
    investor1CredentialCid: null,
    investor2RequestCid: null,
    investor2CredentialCid: null,
    subscription1Cid: null,
    subscription2Cid: null,
    // CIP-56/DFNS groundwork -- only Alice's AddressBookEntry is tracked
    // (Bob's link attempt is expected to fail and never creates one),
    // updated in place across link -> unlink -> relink the same way
    // investor1CredentialCid gets replaced across Suspend/Reinstate.
    investor1AddressBookCid: null,
    // Locked in at the moment step 2 runs, so this run's later steps
    // keep using the scenario data as it was when the run started, even
    // if SCENARIOS itself is inspected again later.
    activeScenario: null,
    activeNet: null,
    activePassThrough: null,
    stepDone: {
      setup: false, attest: false, validate: false, distribute: false,
      entitlement: false, allocate: false, release: false,
      createProofLog: false,
      settle: false, markPaid: false, markPaid2: false, markPaid3: false,
      attestFirst: false, validateFirst: false, revoke: false,
      attestSecond: false, validateRejected: false, renew: false,
      validateRenewed: false,
      draftReport: false, finalizeReport: false,
      requestOnboarding1: false, approveOnboarding1: false,
      requestSubscription1: false, acceptSubscription1: false,
      requestOnboarding2: false, rejectOnboarding2: false,
      requestSubscription2: false, acceptSubscription2Rejected: false,
      linkWallet1: false, linkWallet2Rejected: false,
      unlinkWallet1: false, relinkWallet1: false,
    },
  };
}

const initialState = {
  // Setup's actual output -- reused across every scenario's run since
  // it's the same parties/registry/holdings regardless of which
  // scenario clicked "1. Setup" first.
  parties: null,
  registryCid: null,
  holdingsCid: null,
  scenarioValue: "standardRent",
  runs: {}, // { [scenarioKey]: run state }, created lazily on first use
  log: [], // { id, text, isError }
};

let logCounter = 0;

const demoSlice = createSlice({
  name: "demo",
  initialState,
  reducers: {
    // Setup's own output -- parties, registryCid, holdingsCid -- shared
    // across every scenario, so this patches top-level state directly.
    setSetupField(state, action) {
      Object.assign(state, action.payload);
    },
    setScenarioValue(state, action) {
      state.scenarioValue = action.payload;
    },
    // Patches fields on one scenario's run, creating it first if this is
    // that scenario's first step.
    setRunField(state, action) {
      const { scenario, fields } = action.payload;
      if (!state.runs[scenario]) state.runs[scenario] = emptyRun();
      Object.assign(state.runs[scenario], fields);
    },
    setRunStepDone(state, action) {
      const { scenario, key } = action.payload;
      if (!state.runs[scenario]) state.runs[scenario] = emptyRun();
      state.runs[scenario].stepDone[key] = true;
    },
    appendLog(state, action) {
      logCounter += 1;
      state.log.unshift({ id: logCounter, text: action.payload.text, isError: !!action.payload.isError });
      if (state.log.length > 50) state.log.length = 50;
    },
    // Only clears the named scenario's run -- other scenarios' progress
    // is untouched. Setup's checkbox for this scenario is kept as-is
    // (not forced back to unchecked) since there's nothing to redo there.
    resetRun(state, action) {
      const scenario = action.payload;
      const wasSetupDone = state.runs[scenario]?.stepDone?.setup ?? false;
      const fresh = emptyRun();
      fresh.stepDone.setup = wasSetupDone;
      state.runs[scenario] = fresh;
    },
  },
});

export const {
  setSetupField, setScenarioValue,
  setRunField, setRunStepDone, appendLog, resetRun,
} = demoSlice.actions;
export const EMPTY_RUN = emptyRun();
export default demoSlice.reducer;
