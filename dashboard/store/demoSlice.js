import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  parties: null,
  registryCid: null,
  holdingsCid: null,
  attestationCid: null,
  validatedCid: null,
  distributionCid: null,
  entitlementCid: null,
  settlementCids: null,
  // Locked in at the moment step 2 runs, so steps 3-5's log messages
  // (and the math behind them) stay consistent even if someone changes
  // the scenario dropdown mid-run -- the dropdown gets disabled during a
  // run for the same reason.
  activeScenario: null,
  activeNet: null,
  activePassThrough: null,
  scenarioValue: "standardRent",
  stepDone: {
    setup: false, attest: false, validate: false, distribute: false,
    entitlement: false, settle: false, markPaid: false, markPaid2: false, markPaid3: false,
  },
  log: [], // { id, text, isError }
};

let logCounter = 0;

const demoSlice = createSlice({
  name: "demo",
  initialState,
  reducers: {
    // Generic patch -- most step functions just need to stash one or two
    // new contract ids plus whatever they computed, not a dedicated
    // reducer per field.
    setField(state, action) {
      Object.assign(state, action.payload);
    },
    setStepDone(state, action) {
      state.stepDone[action.payload] = true;
    },
    setScenarioValue(state, action) {
      state.scenarioValue = action.payload;
    },
    appendLog(state, action) {
      logCounter += 1;
      state.log.unshift({ id: logCounter, text: action.payload.text, isError: !!action.payload.isError });
      if (state.log.length > 50) state.log.length = 50;
    },
    resetForNewScenario(state) {
      state.attestationCid = null;
      state.validatedCid = null;
      state.distributionCid = null;
      state.entitlementCid = null;
      state.settlementCids = null;
      state.activeScenario = null;
      state.activeNet = null;
      state.activePassThrough = null;
      for (const key of ["attest", "validate", "distribute", "entitlement", "settle", "markPaid", "markPaid2", "markPaid3"]) {
        state.stepDone[key] = false;
      }
    },
  },
});

export const { setField, setStepDone, setScenarioValue, appendLog, resetForNewScenario } = demoSlice.actions;
export default demoSlice.reducer;
