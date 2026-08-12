// Which templates map to which pipeline column, in display order.
// Matched against the tail of the JSON API's templateId
// ("<packageId>:Ozmium.Attestation:RevenueAttestation") since the
// package-id hash prefix isn't something we can hardcode.
export const STAGES = [
  { key: "attestation", label: "Attestation", template: "Ozmium.Attestation:RevenueAttestation" },
  { key: "validation", label: "Validation", template: "Ozmium.Validation:ValidatedRevenueEvent" },
  { key: "distribution", label: "Distribution Decision", template: "Ozmium.Distribution:DistributionDecision" },
  // Mission 2's other entitlement basis: a static SAFT cap table
  // released against a vesting schedule, instead of a recurring
  // waterfall -- only populated when the "Token vesting release" demo
  // scenario runs, empty otherwise.
  { key: "allocation", label: "Allocation Table (SAFT)", template: "Ozmium.Allocation:AllocationTable" },
  { key: "entitlement", label: "Entitlement", template: "Ozmium.Entitlement:EntitlementCalculation" },
  { key: "settlement", label: "Settlement", template: "Ozmium.Settlement:SettlementInstruction" },
  // Week 3 additions. Distribution Report only ever shows the finalized
  // report, not the short-lived Draft in between -- same reasoning as
  // Settlement showing Pending/Paid within one column instead of
  // splitting into two. Onboarding Request and Investor Credential are
  // two separate columns on purpose, unlike Draft/Report -- an
  // outstanding request is meaningful state worth seeing (it can sit
  // undecided for a while), not a one-click-and-gone intermediate step.
  // Both, plus Subscription, are populated only by the "Investor
  // onboarding" demo scenario, same as Allocation Table only being
  // populated by the vesting scenario.
  { key: "distributionReport", label: "Distribution Report", template: "Ozmium.Reporting:DistributionReport" },
  { key: "onboardingRequest", label: "Onboarding Request", template: "Ozmium.Investor:InvestorOnboardingRequest" },
  { key: "investorCredential", label: "Investor Credential", template: "Ozmium.Investor:InvestorCredential" },
  { key: "subscription", label: "Subscription", template: "Ozmium.Subscription:SubscriptionRequest" },
  // CIP-56/DFNS groundwork -- the AddressBook Identity Mapper. Only
  // populated once the "Investor onboarding" scenario links an Approved
  // investor's Canton PartyID to a (manually-entered, no live DFNS API
  // yet) wallet id -- same "empty unless its scenario runs" pattern as
  // Allocation Table and the three onboarding columns above.
  { key: "addressBookEntry", label: "Address Book Entry (DFNS)", template: "Ozmium.AddressBook:AddressBookEntry" },
];

export const SETUP_TEMPLATES = {
  registry: "Ozmium.Validation:AttestorRegistry",
  holdings: "Ozmium.Entitlement:HoldingsSnapshot",
};

export const PKG = "#ozmium-cashflow";
