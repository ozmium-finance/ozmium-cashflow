// Preset scenarios so the demo isn't limited to one hardcoded number
// set. `kind` picks which step sequence and contract chain DemoPanel
// drives: "waterfall" scenarios all reuse the same asset/registry/
// holdings from Setup and go through the recurring Attestation ->
// Validation -> DistributionDecision chain (Entitlement.daml). The
// "vesting" scenario is Mission 2's other entitlement basis -- a static
// cap table released against a cliff/vesting schedule (Allocation.daml)
// -- so it skips attest/validate/distribute entirely and creates its
// own AllocationTable instead. Both kinds converge back onto the same
// EntitlementCalculation/SettlementInstruction shape, which is exactly
// the point of the Mission 2 generalization work.
export const SCENARIOS = {
  standardRent: {
    kind: "waterfall",
    label: "June rent — retains debt-service reserve",
    revenueType: "Rent", periodStart: "2026-06-01", periodEnd: "2026-06-30",
    grossAmount: "12500.00", currency: "EUR",
    deductions: [
      { deductionType: "management fee", amount: "500.00" },
      { deductionType: "servicing", amount: "125.00" },
    ],
    retentionAmount: "1875.00", retentionReason: "debt-service reserve",
    // A few days after the period closes -- when the report step gets
    // clicked, not when the revenue period itself ended.
    reportGeneratedOn: "2026-07-05",
  },
  passThroughRent: {
    kind: "waterfall",
    label: "July rent — full pass-through, no retention",
    revenueType: "Rent", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    grossAmount: "13200.00", currency: "EUR",
    deductions: [
      { deductionType: "management fee", amount: "528.00" },
    ],
    retentionAmount: "0.00", retentionReason: "",
    reportGeneratedOn: "2026-08-05",
  },
  quarterlyCoupon: {
    kind: "waterfall",
    label: "Quarterly bond coupon (USD)",
    revenueType: "Coupon", periodStart: "2026-04-01", periodEnd: "2026-06-30",
    grossAmount: "50000.00", currency: "USD",
    deductions: [
      { deductionType: "trustee fee", amount: "1000.00" },
    ],
    retentionAmount: "9000.00", retentionReason: "principal amortization reserve",
    reportGeneratedOn: "2026-07-05",
  },
  tokenVesting: {
    kind: "vesting",
    label: "Token vesting release — OZM SAFT (fixed/vesting basis)",
    assetId: "OZM-SAFT-2026",
    tokenSymbol: "OZM",
    // Holder keys match the party roles Setup already allocates
    // (investor1/investor2 = Alice/Bob) so this scenario doesn't need
    // its own investor set.
    allocations: [
      { holder: "investor1", amount: "100000.00" },
      { holder: "investor2", amount: "50000.00" },
    ],
    // 6-month cliff / 24-month vest, TGE on 2026-01-01 -- releasing as
    // of 2027-01-01 (365 days in) lands exactly halfway through the
    // vesting window, so the demo visibly shows a partial (not
    // all-or-nothing) release, same case the new test suite checks.
    triggerDate: "2026-01-01", cliffDays: 180, vestingDays: 730,
    asOfDate: "2027-01-01",
  },
  attestorLicensing: {
    kind: "licensing",
    label: "Attestor licensing — revoke & renew (PropManagerCo)",
    // Same asset/attestor Setup already wires up (berlin-hauptstrasse-12
    // / PropManagerCo), just enough revenue data for two monthly
    // periods -- this scenario is demonstrating Ozmium.Validation's
    // trust-layer mechanism, not the money math, so it deliberately
    // stops at Validate rather than going on to
    // distribution/entitlement/settlement.
    revenueType: "Rent",
    periods: [
      {
        periodStart: "2026-08-01", periodEnd: "2026-08-31",
        grossAmount: "10000.00", currency: "EUR",
        deductions: [{ deductionType: "management fee", amount: "400.00" }],
      },
      {
        periodStart: "2026-09-01", periodEnd: "2026-09-30",
        grossAmount: "10500.00", currency: "EUR",
        deductions: [{ deductionType: "management fee", amount: "420.00" }],
      },
    ],
    renewedExpiresOn: "2031-01-01",
  },
  investorOnboarding: {
    kind: "onboarding",
    label: "Investor onboarding — KYC gate & subscription (SAFT)",
    // Reuses Setup's existing investor1/investor2 (Alice/Bob) rather
    // than allocating new parties -- this scenario is about the
    // registration/subscription contracts themselves, not about who the
    // investors are. berlinSpv plays the issuer role here, same as it
    // plays `fund` everywhere else -- one party, several titles
    // depending on which contract's looking at it.
    assetId: "OZM-SAFT-2026",
    currency: "OZM",
    // Alice: registered, approved, subscribes, gets accepted -- the
    // happy path all the way through.
    approvedInvestor: "investor1",
    approvedAmount: "25000.00",
    // Bob: registered, then rejected -- his subscription request looks
    // exactly as valid as Alice's, but Accept has to turn it away
    // anyway, since that's the one real check this skeleton exists to
    // prove out.
    rejectedInvestor: "investor2",
    rejectedAmount: "10000.00",
    // CIP-56/DFNS groundwork -- once Alice's credential is Approved, her
    // Canton PartyID gets linked to a *real* DFNS-custodied CantonTestnet
    // wallet (created live via lib/dfnsServer.js, not a placeholder
    // string), then unlinked and relinked to a second real wallet
    // (rotation), same "gate proven, then full lifecycle shown" shape as
    // the credential itself demonstrating Suspend/Reinstate in
    // Checkpoint7's tests. Bob's Rejected credential attempts the same
    // link and is turned away before DFNS is ever called -- the
    // AddressBook Identity Mapper is exactly as gated as subscription
    // acceptance is, since both check the same credential.
  },
};
