// Two step sequences, one per scenario `kind` (see scenarios.js). The
// waterfall chain is the original Attestation -> Validation ->
// DistributionDecision -> Entitlement pipeline; the vesting chain skips
// straight to creating an AllocationTable and releasing against it.
// Both converge on the same settle/markPaid steps afterward, since
// EntitlementCalculation_Settle and Settlement_MarkPaid don't care which
// basis produced the entitlement.
export const STEP_ORDER = {
  waterfall: [
    "setup", "attest", "validate", "distribute", "entitlement",
    "settle", "markPaid", "markPaid2", "markPaid3",
  ],
  vesting: [
    "setup", "allocate", "release",
    "settle", "markPaid", "markPaid2",
  ],
};

export function stepOrderFor(kind) {
  return STEP_ORDER[kind] || STEP_ORDER.waterfall;
}

const STEP_TEXT = {
  setup: "Setup (parties, registry, holdings)",
  attest: "Attest revenue",
  validate: "Validate",
  distribute: "Decide distribution",
  entitlement: "Calculate entitlement",
  allocate: "Create allocation table (SAFT cap table + vesting schedule)",
  release: "Calculate vested entitlement (release)",
  settle: "Settle",
  markPaid: "Mark first payment paid",
  markPaid2: "Mark second payment paid",
  markPaid3: "Mark third payment paid",
};

// Numbered relative to the scenario's own step order, since "settle" is
// step 6 in the waterfall chain but step 4 in the vesting chain.
export function stepLabel(kind, key) {
  const idx = stepOrderFor(kind).indexOf(key);
  return `${idx + 1}. ${STEP_TEXT[key]}`;
}
