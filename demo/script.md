# Demo Script — Ozmium × Canton Mission

About 5 minutes. Built around the "ownership vs. income" framing from
the Mission Brief: tokenization answered *who owns this asset?* Ozmium
answers *how does the money it generates actually move, correctly and
provably, every time?*

## Setup (before you're on stage)

Daml 3.5.x / `dpm`, not the old `daml` CLI (see "Toolchain" in the root
README). No Navigator anymore, and no `daml start`-style auto-seeding —
sandbox and setup are two separate steps now:

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
`InvestorBob`, `InvestorCarol`, and prints the `AttestorRegistry`/
`HoldingsSnapshot` ids via `debug`. Grab those from the output — no
contract keys anymore, so this is the only way to get them back. You'll
need the registry id for step 3 and the holdings id for step 4.

## 1. The problem (30s)

"A tokenized building doesn't automatically pay rent to its token
holders. Tokenization solved *who owns this asset* — it didn't solve
*how the income that asset generates actually moves, correctly and
provably, every time*. That's the gap Ozmium closes, and today we're
showing that Canton is where that logic can actually live."

## 2. Attestation — trust enters the system (60s)

Run the mock attestor (see `integration/mock-attestor/README.md` for
the Daml Script option):

```bash
cd integration/mock-attestor
dpm build
dpm script --dar .daml/dist/ozmium-mock-attestor-0.1.0.dar \
  --script-name MockAttestor:runMockAttestation \
  --ledger-host localhost --ledger-port 6865
```

"PropManagerCo, the property manager for a Berlin residential building,
just attested that €12,500 in rent came in for July 2026 — €500 in
management fees and €125 in servicing fees, itemized separately rather
than netted out. That itemization is deliberate: it's what lets Ozmium's
waterfall actually see and apply the deductions, instead of just
trusting a number someone else already calculated."

Point at the `RevenueAttestation` id printed via `debug` — signed by
`PropManagerCo`, visible to `BerlinSPV`. Query it through the JSON API
if you want to show the actual payload instead of just the id.

**Trust model:** "This is the regulated-attestor model on purpose, not a
decentralized oracle. Rent is a private fact tied to one specific lease
— there's no public feed to check it against. Someone has to be the
accountable source of truth, and regulators would rather hold a named
party liable than trust an anonymous set of nodes. That's the required
model for this build."

## 3. Validation (45s)

Exercise `Attestation_Validate` from `BerlinSPV`, passing the
`AttestorRegistry` id from setup and `knownPriorEventCids = []` (nothing
prior for this asset yet).

"Validation checks whether this is actually the registered attestor for
this property, and whether the math holds up. An unregistered party gets
rejected no matter what. Duplicate periods are worth pausing on though —
Canton 3.x dropped contract keys, so the ledger can't just prove on its
own that a period hasn't already been validated the way it could under
Daml 2. `knownPriorEventCids` is the workaround: pass in whatever prior
events you already know about for this asset, and it'll fail hard if any
of them match this period. It's covered in
`tests/scenarios/Checkpoint2_Validation.daml` — including a test showing
it catches a duplicate, and one showing it *doesn't* if you pass `[]`.
Better to be upfront about that boundary than pretend it's an
unconditional guarantee."

Show the resulting `ValidatedRevenueEvent` — net distributable comes out
to €11,875.

## 4. Entitlement calculation (45s)

Exercise `ValidatedRevenueEvent_CalculateEntitlement` with the
`HoldingsSnapshot` (Alice 50%, Bob 30%, Carol 20%).

"€11,875 splits pro-rata: €5,937.50 to Alice, €3,562.50 to Bob, €2,375 to
Carol. This is the simplest possible waterfall on purpose — a real
deployment would plug in tranches or a hurdle rate here, but the
contract shape doesn't need to change for that. `EntitlementCalculation`
and `EntitlementLine` aren't real-estate-specific."

## 5. Settlement — the auditable payout (60s)

Exercise `EntitlementCalculation_Settle`.

"Three settlement instructions, one per investor, each one carrying the
exact reference back to July's rent statement. This is the auditability
requirement made concrete — a regulator could start at any payout and
trace it straight back to the event that caused it, no application code
required. It's all sitting on the ledger."

Optionally mark one as paid (`Settlement_MarkPaid`) to close the loop.

## 6. Chain-agnostic framing (30s)

"Notice what never came up in any of this: which chain the property
token was actually issued on. Canton handled the money — attestation,
validation, waterfall, settlement — completely independent of whether
the token lives on Hedera, Ethereum, wherever. That's the actual thesis
here: tokenization solved ownership, Canton is the execution layer for
the cashflow that ownership generates."

## 7. Oracle stretch goal, if there's time (30s)

Change gears here: "Separately from all of that — and this was never
part of the required flow — for asset classes where public data
actually exists, like a bond's coupon rate, we can add an oracle check
on top." Run `test_oracleFlagsMismatch` from
`tests/scenarios/Stretch_OracleCorroboration.daml` and show the
`Mismatch` result.

"None of this touches Attestation, Validation, Entitlement, or
Settlement — it's its own module, `Ozmium.Oracle`, and you could delete
it entirely without putting the core path at risk. We didn't wire it up
for real estate because there's no independent rent-roll data to check
against — that's a scope decision, not something missing."

## Close (15s)

"Full lifecycle, one asset class, end to end, auditable, running on
Canton. Same pattern — attest, validate, calculate, settle — carries
over to bond coupons and loan repayments in phase two without a
redesign."
