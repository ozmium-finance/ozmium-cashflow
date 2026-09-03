// Three step sequences, one per scenario `kind` (see scenarios.js). The
// waterfall chain is the original Attestation -> Validation ->
// DistributionDecision -> Entitlement pipeline; the vesting chain skips
// straight to creating an AllocationTable and releasing against it. Both
// converge on the same settle/markPaid steps afterward, since
// EntitlementCalculation_Settle and Settlement_MarkPaid don't care which
// basis produced the entitlement. The licensing chain is different in
// kind, not just contract sequence -- it's demonstrating
// Ozmium.Validation's trust-layer mechanism itself (a revoked attestor
// gets rejected, a renewed one doesn't), so it stops at Validate and
// never touches distribution/entitlement/settlement at all.
export const STEP_ORDER = {
  waterfall: [
    "setup", "attest", "validate", "distribute", "entitlement",
    "settle", "markPaid", "markPaid2", "markPaid3",
    // Week 3 addition -- once every settlement's Paid, roll them up
    // into an on-ledger report. Tacked onto the end of the waterfall
    // chain rather than made its own scenario, since a report needs
    // real Paid settlements to summarize and the waterfall scenarios
    // are exactly where those come from.
    "draftReport", "finalizeReport",
  ],
  vesting: [
    "setup", "allocate", "release",
    // Week 4 -- the CIP-56/DFNS settlement wiring, chained into the SAFT
    // scenario itself instead of only ever existing as the separate
    // onboarding scenario's own demo path. Issuer wallet first (the
    // treasury side settle will pay out of), then both holders onboarded
    // and wallet-linked (their own credential relationship with
    // OzmiumIssuer, distinct from their berlinSpv one in the onboarding
    // scenario) -- all before settle needs any of it.
    "linkIssuerWallet",
    // Week 6 -- the hash-chained proof log starts here (Ozmium.ProofLog).
    // Placed right after the treasury wallet, before onboarding/settle,
    // so both pieces of "real settlement" infrastructure -- the payment
    // rail and the tamper-evident record of it -- are set up together.
    "createProofLog",
    "onboardHolders", "linkHolderWallets",
    "settle", "markPaid", "markPaid2",
  ],
  licensing: [
    "setup", "attestFirst", "validateFirst", "revoke",
    "attestSecond", "validateRejected", "renew", "validateRenewed",
  ],
  // Week 3's other addition -- investor onboarding gating a
  // subscription, self-onboarding propose-accept style (DA Registry's
  // own pattern, per Alex's direction) rather than admin unilaterally
  // registering someone. Two investors on purpose: Alice proposes,
  // gets Approved, and her subscription goes through; Bob proposes,
  // gets Rejected, and his subscription request -- which looks
  // identical to Alice's -- gets turned away at Accept anyway. That
  // contrast is the whole point, same reasoning as licensing's
  // revoke/renew pair.
  onboarding: [
    "setup",
    "requestOnboarding1", "approveOnboarding1", "requestSubscription1", "acceptSubscription1",
    "requestOnboarding2", "rejectOnboarding2", "requestSubscription2", "acceptSubscription2Rejected",
    // CIP-56/DFNS groundwork, tacked onto the end for the same reason
    // draftReport/finalizeReport were tacked onto the waterfall chain --
    // this needs a real Approved credential (Alice's) and a real
    // Rejected one (Bob's) to demonstrate the gate, and this scenario is
    // exactly where those come from.
    "linkWallet1", "linkWallet2Rejected", "unlinkWallet1", "relinkWallet1",
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
  linkIssuerWallet: "Link issuer treasury wallet (real DFNS wallet)",
  createProofLog: "Create the proof log (hash-chained, tamper-evident settlement record)",
  onboardHolders: "Onboard both SAFT holders under OzmiumIssuer",
  linkHolderWallets: "Link both holders' Canton PartyIDs to real DFNS wallets",
  settle: "Settle",
  markPaid: "Mark first payment paid (real DFNS CIP-56 transfer)",
  markPaid2: "Mark second payment paid (real DFNS CIP-56 transfer)",
  markPaid3: "Mark third payment paid",
  attestFirst: "Attest revenue (period 1, attestor licensed)",
  validateFirst: "Validate (expect success — licensed)",
  revoke: "Revoke attestor's license",
  attestSecond: "Attest revenue (period 2, same attestor)",
  validateRejected: "Validate (expect rejection — revoked)",
  renew: "Renew attestor's license",
  validateRenewed: "Validate again (expect success — renewed)",
  draftReport: "Draft distribution report",
  finalizeReport: "Finalize report (verify & summarize Paid settlements)",
  requestOnboarding1: "Alice proposes onboarding",
  approveOnboarding1: "Approve Alice's onboarding — issues her credential",
  requestSubscription1: "Alice requests a subscription",
  acceptSubscription1: "Accept Alice's subscription (expect success — Approved credential)",
  requestOnboarding2: "Bob proposes onboarding",
  rejectOnboarding2: "Reject Bob's onboarding — issues a Rejected credential",
  requestSubscription2: "Bob requests a subscription",
  acceptSubscription2Rejected: "Accept Bob's subscription (expect rejection — credential not Approved)",
  linkWallet1: "Link Alice's Canton PartyID to a DFNS wallet",
  linkWallet2Rejected: "Attempt to link Bob's wallet (expect rejection — credential not Approved)",
  unlinkWallet1: "Unlink Alice's wallet mapping",
  relinkWallet1: "Relink Alice to a rotated wallet id",
};

// Numbered relative to the scenario's own step order, since "settle" is
// step 6 in the waterfall chain but step 4 in the vesting chain.
export function stepLabel(kind, key) {
  const idx = stepOrderFor(kind).indexOf(key);
  return `${idx + 1}. ${STEP_TEXT[key]}`;
}
