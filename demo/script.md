# Demo Script — Ozmium × Canton Mission

Target length: ~5 minutes. Keyed to the "ownership vs. income" framing
from the Mission Brief: tokenization answered *who owns this asset?*
Ozmium answers *how does the money it generates actually move, correctly
and provably, every time?*

## Setup (before you're on stage)

Daml 3.5.x tooling (`dpm`, not the deprecated `daml` CLI — see the root
README's "Toolchain" section). No Navigator, and no `daml start`-style
auto-seeding — sandbox and setup are separate steps:

```bash
# terminal 1
dpm build
dpm sandbox --dar .daml/dist/ozmium-cashflow-0.1.0.dar --json-api-port 7575

# terminal 2, once the sandbox is up
dpm script --dar .daml/dist/ozmium-cashflow-0.1.0.dar \
  --script-name Ozmium.Setup:setup \
  --ledger-host localhost --ledger-port 6865
```

`setup` allocates `Admin`, `PropManagerCo`, `BerlinSPV`, `InvestorAlice`,
`InvestorBob`, `InvestorCarol`, and prints the `AttestorRegistry` and
`HoldingsSnapshot` ContractIds via `debug` in the script output — copy
those somewhere handy, since Canton 3.x has no contract keys to look
them back up by asset id (see root README). You'll pass the registry id
into step 3 below and the holdings id into step 4.

## 1. The problem (30s)

"A tokenized building doesn't automatically pay rent to its token
holders. Tokenization solved *who owns this asset* — it didn't solve *how
the income that asset generates actually moves, correctly and provably,
every time*. That's the gap Ozmium closes, and we're showing today that
Canton is where that logic can live."

## 2. Attestation — trust enters the system (60s)

Run the mock attestor (Option A, Daml Script — see
`integration/mock-attestor/README.md`):

```bash
cd integration/mock-attestor
dpm build
dpm script --dar .daml/dist/ozmium-mock-attestor-0.1.0.dar \
  --script-name MockAttestor:runMockAttestation \
  --ledger-host localhost --ledger-port 6865
```

"PropManagerCo — the property manager for a Berlin residential building —
just attested that €12,500 in rent was collected for July 2026, with
€500 in management fees and €125 in servicing fees itemized separately,
not netted out. That itemization matters: it's what lets Ozmium's
waterfall logic actually see and apply deductions, instead of trusting a
pre-calculated number handed to it."

Point out the `RevenueAttestation` contract id printed in the script
output (`debug`) — signed by `PropManagerCo`, visible to `BerlinSPV`.
Query it via the JSON API (`dpm sandbox`'s `--json-api-port`) if you want
to show the actual contract payload live rather than just the id.

**Trust model callout:** "This is deliberately the regulated-attestor
model, not a decentralized oracle. Rent is a private, bespoke fact tied
to a specific lease — there's no public price feed to check it against.
Someone has to be the accountable source of truth, and regulators prefer
a named, liable party over an anonymous node set. That's the primary,
required trust model for this Mission build."

## 3. Validation (45s)

Exercise `Attestation_Validate` from `BerlinSPV` (via a one-off
`dpm script` or a JSON API command), passing the `AttestorRegistry`
contract id from setup and `knownPriorEventCids = []` (nothing prior for
this asset yet).

"Validation checks: is this the party actually registered to attest for
this specific property, and does the math hold up. Try it with an
unregistered party — that gets rejected regardless. Duplicate-period
protection is worth a beat here: Canton 3.x dropped contract keys, so the
ledger can't unconditionally prove a period hasn't already been
validated the way Daml 2.x could. The fix is the `knownPriorEventCids`
parameter — pass in ContractIds you already know about for this asset,
and it hard-fails if any match this period. That's Checkpoint 2, covered
in `tests/scenarios/Checkpoint2_Validation.daml`, including a test that
shows this catching a duplicate *and* one showing it doesn't catch one
if you pass `[]` — worth being upfront about that boundary rather than
overselling it as an unconditional guarantee."

Show the resulting `ValidatedRevenueEvent`: net distributable = €11,875.

## 4. Entitlement calculation (45s)

Exercise `ValidatedRevenueEvent_CalculateEntitlement`, passing the
`HoldingsSnapshot` (Alice 50%, Bob 30%, Carol 20%).

"€11,875 splits pro-rata: €5,937.50 to Alice, €3,562.50 to Bob, €2,375 to
Carol. This is intentionally the simplest waterfall — production would
plug in seniority tranches or a hurdle-rate structure here, but the
contract shape doesn't change: `EntitlementCalculation` and
`EntitlementLine` are generic, not real-estate-specific."

## 5. Settlement — the auditable payout (60s)

Exercise `EntitlementCalculation_Settle`.

"Three `SettlementInstruction` contracts, one per investor, each carrying
the exact `sourceEventRef` back to July's rent statement. This is the
auditability requirement from the brief made concrete: a regulator could
start at any payout and trace it back to the attested event that produced
it, with no application code required — it's all on the ledger."

Optionally exercise `Settlement_MarkPaid` on one instruction to show the
lifecycle closing out.

## 6. Chain-agnostic framing (30s)

"Notice what didn't happen anywhere in this flow: nothing here cared
which chain the underlying property token was issued on. Canton
orchestrated the money movement — attestation, validation, waterfall,
settlement obligation — independent of Hedera, Ethereum, or anywhere
else the token itself might live. That's the core thesis: tokenization
answered ownership, Canton is the execution layer for the cashflow that
ownership actually generates."

## 7. (If time allows) Oracle stretch goal (30s)

Switch context explicitly: "Separately — and this is intentionally not
part of the required flow — for asset classes where public data *does*
exist, like a bond's published coupon rate, we can add an oracle
corroboration check." Run
`tests/scenarios/Stretch_OracleCorroboration.daml`'s
`test_oracleFlagsMismatch` and show the `Mismatch` result.

"This never touches Attestation, Validation, Entitlement, or Settlement —
it's a separate module, `Ozmium.Oracle`, that can be left out entirely
without any risk to the core path. We didn't apply it to the real estate
case because there's no independent public rent-roll data to check
against — that's a deliberate scope decision, not a gap."

## Close (15s)

"Full lifecycle, one asset class, end-to-end, auditable, on Canton. The
same contract pattern — attest, validate, calculate, settle — extends to
bond coupons and loan repayments as phase two, without a redesign."
