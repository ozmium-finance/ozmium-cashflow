# Demo Script — Ozmium × Canton Mission

About 5 minutes. Built around the "ownership vs. income" framing from
the Mission Brief: tokenization answered *who owns this asset?* Ozmium
answers *how does the money it generates actually move, correctly and
provably, every time?*

## Setup (before you're on stage)

Daml 3.5.x / `dpm`, not the old `daml` CLI (see "Toolchain" in the root
README). No Navigator anymore, and no interactive way to poke at a
running sandbox by hand — so instead of manually exercising choices one
at a time, the whole lifecycle runs as a single script,
`Ozmium.Demo:runFullDemo`, that narrates itself via `debug` as it goes.
It allocates its own parties and its own registry/holdings, so it's
fine to run on a completely fresh sandbox — no need to run
`Ozmium.Setup:setup` first.

```bash
# terminal 1
dpm build
dpm sandbox --dar .daml/dist/ozmium-cashflow-0.2.0.dar --json-api-port 7575

# terminal 2, once the sandbox is up
dpm script --dar .daml/dist/ozmium-cashflow-0.2.0.dar \
  --script-name Ozmium.Demo:runFullDemo \
  --ledger-host localhost --ledger-port 6865
```

Have this running before you start talking, or run it live and narrate
over the console output as it scrolls — either works. The talking
points below are keyed to the `debug` lines the script prints, in
order.

## 1. The problem (30s)

"A tokenized building doesn't automatically pay rent to its token
holders. Tokenization solved *who owns this asset* — it didn't solve
*how the income that asset generates actually moves, correctly and
provably, every time*. And that income doesn't move in one hop: rent
flows from tenant to property owner, and only then does the owner
decide what flows on to shareholders. Ozmium makes both of those
movements programmable and auditable on Canton — not just the last
one. That's the gap Ozmium closes, and today we're showing that Canton
is where that logic can actually live."

## 2. Attestation — trust enters the system (60s)

This is `--- Step 1: Attestation ---` in the output.

"PropManagerCo, the property manager for a Berlin residential building,
just attested that €12,500 in rent came in for July 2026 — €500 in
management fees and €125 in servicing fees, itemized separately rather
than netted out. That itemization is deliberate: it's what lets Ozmium's
waterfall actually see and apply the deductions, instead of just
trusting a number someone else already calculated."

Point at the `RevenueAttestation` id in the output — signed by
`PropManagerCo`, visible to `BerlinSPV`. If you want to show the actual
payload instead of just the id, query it through the JSON API, or run
the mock-attestor integration separately (see
`integration/mock-attestor/README.md`) to show the "external system
calling in over HTTP" version of the same step.

**Trust model:** "This is the regulated-attestor model on purpose, not a
decentralized oracle. Rent is a private fact tied to one specific lease
— there's no public feed to check it against. Someone has to be the
accountable source of truth, and regulators would rather hold a named
party liable than trust an anonymous set of nodes. That's the required
model for this build."

## 3. Validation — property-level net operating income (45s)

This is `--- Step 2: Validation ---` in the output.

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

The output shows the resulting net operating income: €11,875. "That's
the first hop — tenant to property owner. It's not the last."

## 4. Distribution decision — ownership-level, the second hop (45s)

This is `--- Step 3: Distribution decision ---` in the output.

"Here's where it used to just flow straight through. In real
institutional deals, the SPV doesn't always pass through 100% of net
operating income — it might hold back a reserve, or cover debt service
first. So BerlinSPV makes that call explicitly, on-ledger: retains
€1,875 as a debt-service reserve, passes through €10,000. That's a
recorded policy decision, not a hardcoded assumption — a fund that
passes through everything just makes the same decision with a
retention of zero. Either way it's on the ledger, not implicit in the
code."

## 5. Entitlement calculation (45s)

This is `--- Step 4: Entitlement calculation ---` in the output.

"The €10,000 pass-through amount — not the raw €11,875 — splits
pro-rata: €5,000 to Alice, €3,000 to Bob, €2,000 to Carol. The retained
reserve never reaches this split. This is still the simplest possible
waterfall on purpose — a real deployment would plug in tranches or a
hurdle rate here, but the contract shape doesn't need to change for
that. `EntitlementCalculation` and `EntitlementLine` aren't
real-estate-specific."

## 6. Settlement — the auditable payout (60s)

This is `--- Step 5: Settlement ---` in the output.

"Three settlement instructions, one per investor, each one carrying the
exact reference back to July's rent statement. This is the auditability
requirement made concrete — a regulator could start at any payout and
trace it straight back to the event that caused it, and back further
still to the SPV's retention decision, no application code required.
It's all sitting on the ledger."

The script marks the first one `Paid` at the end, to close the loop.

## 7. Chain-agnostic framing (30s)

"Notice what never came up in any of this: which chain the property
token was actually issued on. Canton handled the money — attestation,
validation, waterfall, settlement — completely independent of whether
the token lives on Hedera, Ethereum, wherever. That's the actual thesis
here: tokenization solved ownership, Canton is the execution layer for
the cashflow that ownership generates."

## 8. Oracle stretch goal, if there's time (30s)

Change gears here: "Separately from all of that — and this was never
part of the required flow — for asset classes where public data
actually exists, like a bond's coupon rate, we can add an oracle check
on top." This one isn't part of `runFullDemo` on purpose. Run it
separately with:

```bash
cd tests/scenarios
dpm test
```

and point at `test_oracleFlagsMismatch` in
`Stretch_OracleCorroboration.daml` in the test output.

"None of this touches Attestation, Validation, Entitlement, or
Settlement — it's its own module, `Ozmium.Oracle`, and you could delete
it entirely without putting the core path at risk. We didn't wire it up
for real estate because there's no independent rent-roll data to check
against — that's a scope decision, not something missing."

## Close (15s)

"Full lifecycle, one asset class, end to end, auditable, running on
Canton — both hops of it, property to owner and owner to shareholders.
Same pattern — attest, validate, decide, calculate, settle — carries
over to bond coupons and loan repayments in phase two without a
redesign."
