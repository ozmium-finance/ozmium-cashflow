// Which templates map to which pipeline column, in display order.
// Matched against the tail of the JSON API's templateId
// ("<packageId>:Ozmium.Attestation:RevenueAttestation") since the
// package-id hash prefix isn't something we can hardcode.
export const STAGES = [
  { key: "attestation", label: "Attestation", template: "Ozmium.Attestation:RevenueAttestation" },
  { key: "validation", label: "Validation", template: "Ozmium.Validation:ValidatedRevenueEvent" },
  { key: "distribution", label: "Distribution Decision", template: "Ozmium.Distribution:DistributionDecision" },
  { key: "entitlement", label: "Entitlement", template: "Ozmium.Entitlement:EntitlementCalculation" },
  { key: "settlement", label: "Settlement", template: "Ozmium.Settlement:SettlementInstruction" },
];

export const SETUP_TEMPLATES = {
  registry: "Ozmium.Validation:AttestorRegistry",
  holdings: "Ozmium.Entitlement:HoldingsSnapshot",
};

export const PKG = "#ozmium-cashflow";
