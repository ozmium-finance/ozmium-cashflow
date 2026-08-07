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
    // Only used by the attestor-licensing scenario -- two separate
    // RevenueAttestations (before and after the revoke/renew cycle),
    // kept as distinct fields since both are alive across several
    // steps at once (unlike the waterfall/vesting chains, which only
    // ever have one attestation-shaped contract in flight).
    firstAttestationCid: null,
    secondAttestationCid: null,
    // Locked in at the moment step 2 runs, so this run's later steps
    // keep using the scenario data as it was when the run started, even
    // if SCENARIOS itself is inspected again later.
    activeScenario: null,
    activeNet: null,
    activePassThrough: null,
    stepDone: {
      setup: false, attest: false, validate: false, distribute: false,
      entitlement: false, allocate: false, release: false,
      settle: false, markPaid: false, markPaid2: false, markPaid3: false,
      attestFirst: false, validateFirst: false, revoke: false,
      attestSecond: false, validateRejected: false, renew: false,
      validateRenewed: false,
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
