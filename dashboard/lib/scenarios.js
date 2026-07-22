// Three preset scenarios so the demo isn't limited to one hardcoded
// number set. All three reuse the same asset/registry/holdings from
// Setup (so Setup only ever needs to run once per session) -- what
// varies is the kind of revenue, whether the SPV retains anything, and
// currency, to show the pipeline handling more than one shape of deal.
export const SCENARIOS = {
  standardRent: {
    label: "June rent — retains debt-service reserve",
    revenueType: "Rent", periodStart: "2026-06-01", periodEnd: "2026-06-30",
    grossAmount: "12500.00", currency: "EUR",
    deductions: [
      { deductionType: "management fee", amount: "500.00" },
      { deductionType: "servicing", amount: "125.00" },
    ],
    retentionAmount: "1875.00", retentionReason: "debt-service reserve",
  },
  passThroughRent: {
    label: "July rent — full pass-through, no retention",
    revenueType: "Rent", periodStart: "2026-07-01", periodEnd: "2026-07-31",
    grossAmount: "13200.00", currency: "EUR",
    deductions: [
      { deductionType: "management fee", amount: "528.00" },
    ],
    retentionAmount: "0.00", retentionReason: "",
  },
  quarterlyCoupon: {
    label: "Quarterly bond coupon (USD)",
    revenueType: "Coupon", periodStart: "2026-04-01", periodEnd: "2026-06-30",
    grossAmount: "50000.00", currency: "USD",
    deductions: [
      { deductionType: "trustee fee", amount: "1000.00" },
    ],
    retentionAmount: "9000.00", retentionReason: "principal amortization reserve",
  },
};
