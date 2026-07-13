# Ozmium Cashflow — Canton Mission Build

Milestone 1 deliverable: a working Daml smart contract prototype of
Ozmium's programmable cashflow layer on the Canton Network, demonstrating
that Canton can serve as the execution layer for institutional cashflow
orchestration. Reference use case: real estate rent collection and
distribution to fractional token holders.

Ozmium is deliberately **not** another tokenization platform. Tokenization
answers *who owns this asset?* Ozmium answers *how does the money it
generates actually move, correctly and provably, every time?* This repo
covers the Canton side of that: attestation → trust-model validation →
entitlement calculation → settlement. Token issuance and distribution
(Hedera or otherwise) is treated as external and chain-agnostic — Canton
orchestrates money movement, it does not re-tokenize the underlying asset.

## Repo layout

```
ozmium-cashflow/
├── daml.yaml               # main contract package
├── daml/Ozmium/
│   ├── Types.daml          # shared data types (RevenueType, Deduction, EntitlementLine)
│   ├── Attestation.daml    # Checkpoint 1 — RevenueAttestation
│   ├── Validation.daml     # Checkpoint 2 — AttestorRegistry, ValidatedRevenueEvent
│   ├── Entitlement.daml    # Checkpoint 3 — HoldingsSnapshot, EntitlementCalculation
│   ├── Settlement.daml     # Checkpoint 4 — SettlementInstruction
│   ├── Oracle.daml         # STRETCH GOAL — oracle corroboration (separate, optional)
│   └── Setup.daml          # demo party allocation + init-script for `daml start`
├── integration/mock-attestor/   # simulates the property manager submitting events
├── tests/scenarios/         # Daml Script tests, one file per checkpoint
└── demo/script.md           # live demo narration
```

This deviates from the Dev Build Guide's ASCII tree in one place worth
flagging: `daml.yaml` sits at the repo root with `source: daml`, rather
than nested inside `daml/`. That's the standard layout `daml new`
scaffolds and what most Daml tooling assumes; functionally it's the same
project structure. `tests/scenarios/` and `integration/mock-attestor/`
are each their own small Daml package (own `daml.yaml`, depending on the
built main `.dar` via `data-dependencies`) so they can live in their own
top-level folders as specified, rather than being folded into `daml/` as
extra modules. See the build order below — it matters.

## How to run locally

Install the Daml SDK if you haven't:

```bash
curl -sSL https://get.daml.com/ | sh
daml version
```

Build and test, in order (the test/mock-attestor packages depend on the
main package's compiled `.dar`, so it has to exist first):

```bash
# 1. Main contract package
daml build

# 2. Test suite (depends on step 1's output)
cd tests/scenarios
daml build && daml test
cd ../..

# 3. Mock attestor integration (depends on step 1's output)
cd integration/mock-attestor
daml build
cd ../..
```

Interactive demo (Sandbox + Navigator, auto-seeded via
`Ozmium.Setup:setup`):

```bash
daml start
```

Then either drive it through Navigator, or run the mock attestor against
the running sandbox — see `integration/mock-attestor/README.md` for both
the Daml Script and JSON-API-over-HTTP options.

## How to deploy (Canton test/Mission environment)

1. Confirm the participant node URL and party allocation process with
   whoever's providing the shared Canton testnet — the Dev Build Guide
   flags this as an early task, not a last-day one.
2. `daml build` to produce `.daml/dist/ozmium-cashflow-0.1.0.dar`.
3. Upload the dar to the target participant (`daml ledger upload-dar
   --host <participant-host> --port <participant-port>
   .daml/dist/ozmium-cashflow-0.1.0.dar`).
4. Allocate real parties for PropManagerCo/BerlinSPV/investors on that
   participant (replacing `Ozmium.Setup`'s auto-allocated demo parties),
   and re-run the equivalent of `setup` — creating the `AttestorRegistry`
   and `HoldingsSnapshot` — against the live parties.
5. Point `integration/mock-attestor` at the real participant's ledger
   host/port (Daml Script option) or JSON API URL (Python option).

## Architecture decisions

### Why the regulated-attestor trust model, not oracle-first

Rent, loan repayments, and most real-world cashflow events are private,
bespoke facts tied to a specific lease or loan agreement — they aren't
publicly observable data like an FX rate, so there's nothing for a
decentralized oracle network to independently check against. Someone
still has to be the original source of truth; an oracle can only relay or
corroborate what that party reports, not discover the fact itself.
Regulators (MiCA/CASP) also generally prefer a named, contractually
accountable attestor they can hold liable over an anonymous node set.

Concretely, in this codebase: `RevenueAttestation` (`Attestation.daml`)
requires `signatory attestor` — only the attestor party can bring one
into existence, and the ledger enforces that structurally, not as an
application-level check that could be bypassed. `Attestation_Validate`
then checks the attestation against `AttestorRegistry`
(`Validation.daml`) — is this party actually the one registered as
authoritative for this specific asset — before it's allowed to become a
`ValidatedRevenueEvent` that entitlement/settlement logic can act on.

Oracle corroboration (`Oracle.daml`) is additive, not a replacement, and
lives in a fully separate module that nothing in the core flow imports or
depends on. It's scoped to bond coupon rates specifically, where a
published reference rate genuinely exists to check against — not real
estate rent, which has no independent public data source.

### Why entitlement is a separate contract/choice from validation

`ValidatedRevenueEvent_CalculateEntitlement` takes a `HoldingsSnapshot` as
a parameter rather than reading holdings off the `ValidatedRevenueEvent`
itself. That's what keeps the cashflow logic chain-agnostic: swapping a
manually-attested `HoldingsSnapshot` for a live read of CIP-56 holdings
(or Hedera HTS balances) later doesn't require touching
Attestation/Validation/Settlement at all — only how a `HoldingsSnapshot`
gets created changes.

### Why deductions are itemized, not netted upstream

`Deduction` is a list of `(type, amount)` pairs on the attestation itself,
not a single pre-calculated net figure. Ozmium's value-add is the
programmable waterfall — if a servicer handed over a netted number, that
logic would be invisible to the ledger and impossible to vary per deal.
Itemizing also sets up Canton's selective-disclosure privacy model to
eventually restrict who sees line-item fee detail versus just net
figures, per the open question raised in the Revenue Attestation
Architecture doc.

### Extensibility to bonds/private credit (phase two)

Nothing in `Types.daml`, `Validation.daml`, `Entitlement.daml`, or
`Settlement.daml` is real-estate-specific. `RevenueType` already includes
`Coupon` and `LoanRepayment` alongside `Rent`. A bond coupon event is
attested, validated against a registered paying-agent/trustee, split
pro-rata (or via a different waterfall) across holders, and settled
through the exact same contract choices — only the attestor's real-world
role and the registry's data change. `Oracle.daml`'s bond corroboration
check is the first concrete example of a phase-two-specific extension
living alongside the core pattern without modifying it.

### Auditability

Every `SettlementInstruction` carries `sourceEventRef`, tracing back to
the attestation's `source_reference`. `EntitlementCalculation` retains
`attestor` as a signatory alongside `fund`, so the provenance chain
(attestation → validation → entitlement → settlement) is part of the
ledger's own signatory/observer structure, not something that has to be
reconstructed from application logs. `tests/scenarios/Checkpoint4_Settlement.daml`
asserts this explicitly: the sum of settlement amounts equals the
validated event's net distributable amount, and every settlement's
`sourceEventRef` matches the original attestation.

## Known limitations / what a next milestone would add

- Waterfall is pro-rata only; no seniority tranches, hurdle rates, or
  fee-on-fee structures yet.
- `AttestorRegistry` governance is a single admin party; production needs
  multi-sig/committee governance and a defined legal onboarding process
  for attestors (open question in the Revenue Attestation Architecture
  doc).
- No dispute/reversal path for a wrong or fraudulent attestation once
  settled — currently a legal-recourse-only model.
- `Settlement_MarkPaid` is manually triggered; a production build would
  tie this to actual confirmation from the payment/token rail (e.g. a
  Hedera stablecoin transfer confirming).
- This sandbox environment could not reach the Daml SDK download servers
  to compile/run `daml build`/`daml test` — all Daml source here is
  believed correct against SDK 2.9.x/2.10.x semantics but has not been
  machine-verified. Run `daml build && daml test` locally as the first
  step before relying on this for the Mission submission.
