# Ozmium Cashflow — Canton Mission Build

Milestone 1 deliverable: a working Daml prototype of Ozmium's
programmable cashflow layer on Canton, showing that Canton can act as
the execution layer for institutional cashflow orchestration. Reference
use case is real estate — rent collection and distribution to
fractional token holders.

Worth repeating the framing since it drives most of the design choices
below: Ozmium isn't a tokenization platform. Tokenization tells you who
owns something. Ozmium is about how the money that thing generates
actually moves — correctly, provably, every time. What's here covers
the Canton side of that: attestation → validation → entitlement →
settlement. Token issuance (Hedera or wherever) is treated as external —
Canton orchestrates the money, it doesn't re-tokenize anything.

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
│   └── Setup.daml          # demo party allocation + seed data (run via `dpm script`)
├── integration/mock-attestor/   # simulates the property manager submitting events
├── tests/scenarios/         # Daml Script tests, one file per checkpoint
├── multi-package.yaml       # lets `dpm build --all` build all 3 packages together
└── demo/script.md           # live demo narration
```

One deviation from the Dev Build Guide's tree worth calling out:
`daml.yaml` sits at the repo root with `source: daml` instead of being
nested inside `daml/`. That's just the standard layout Daml tooling
expects, so functionally nothing's different. `tests/scenarios/` and
`integration/mock-attestor/` are each a small package of their own (own
`daml.yaml`, pulling in the built main `.dar` via `data-dependencies`)
so they can stay in their own top-level folders instead of getting
folded into `daml/`. Build order matters because of this — see below.

## Toolchain: Daml 3.5.x via DPM, not the old `daml` CLI

The live Canton Network has been on Daml 3.x for about a year now (as of
mid-2026). Daml 3.x dropped the `daml` CLI / Daml Assistant in favor of
**DPM** (Digital Asset Package Manager), which you get from
`get.digitalasset.com`. So the `curl -sSL https://get.daml.com/ | sh` /
`daml build` / `daml test` / `daml start` commands in the Dev Build
Guide are Daml 2.x and won't work here. Everything in this repo targets
3.5.x and uses `dpm`. If your local setup looks different, it's usually
just a straight `daml` → `dpm` swap, but check `dpm --help` — I don't
have a real install to test this against, see Known Limitations at the
bottom.

## Contract keys and Canton 3.x

Bigger thing to flag: **Canton 3.x doesn't support Daml contract keys.**
No `key`, `maintainer`, `fetchByKey`, `lookupByKey`, `exerciseByKey` —
none of it. This came straight from Digital Asset's own engineers on the
Canton Network Forum ("Contract keys in DAML 3", May 2025): unique keys
aren't coming back to Canton 3.x, because you fundamentally can't
guarantee uniqueness once you've got independent synchronizers that
might not even be talking to each other at a given moment.

Every template here started out using `key`/`maintainer`, since that's
what you'd naturally reach for coming from the Dev Build Guide's Daml
2.x framing. All of that got pulled out:

- **Registries and snapshots** (`AttestorRegistry`, `HoldingsSnapshot`)
  just get passed around by `ContractId` now. This one was basically
  free — the code already worked that way.
- **Stopping duplicate periods** is the change that actually matters.
  That used to be the `ValidatedRevenueEvent` contract key doing the
  work. Digital Asset's own recommendation here is to push this
  off-ledger: whoever's submitting `Attestation_Validate` (the fund's
  automation, presumably) should check the participant — JSON API or
  PQS — for an existing `ValidatedRevenueEvent` on that fund/asset/period
  first, and just not submit if it finds one. On top of that,
  `Attestation_Validate` takes a `knownPriorEventCids` parameter as a
  bit of on-ledger backup: pass in any prior event ids you already know
  about, and it'll fetch each one and reject if any of them match this
  period. `tests/scenarios/Checkpoint2_Validation.daml` tests both sides
  of this deliberately — the case where it catches a duplicate, and the
  case where it doesn't because you passed `[]` — so the actual boundary
  of what's enforced is visible instead of assumed.

## How to run locally

Install DPM first if you don't have it (check `get.digitalasset.com`
for the current script and manual-install instructions):

```bash
curl -sS "https://get.digitalasset.com/install/latest"   # check latest version
# then follow get.digitalasset.com's install instructions for your OS
dpm --version
```

Build order matters — the test and mock-attestor packages need the main
package's `.dar` to already exist:

```bash
# 1. Main contract package
dpm build

# 2. Test suite
cd tests/scenarios
dpm build && dpm test
cd ../..

# 3. Mock attestor integration
cd integration/mock-attestor
dpm build
cd ../..

# or just build all three from the root:
dpm build --all
```

For the interactive demo, sandbox and seed data are two separate steps
now — DPM doesn't have a `daml start`-style command that runs an init
script for you automatically:

```bash
# terminal 1
dpm sandbox --dar .daml/dist/ozmium-cashflow-0.1.0.dar --json-api-port 7575

# terminal 2, once the sandbox is up
dpm script --dar .daml/dist/ozmium-cashflow-0.1.0.dar \
  --script-name Ozmium.Setup:setup \
  --ledger-host localhost --ledger-port 6865
```

`setup` will print the `AttestorRegistry`/`HoldingsSnapshot` ids via
`debug` — grab those from the output, since there's no key lookup to
find them again later. From there, run the mock attestor against the
sandbox; `integration/mock-attestor/README.md` covers both the Daml
Script route and the JSON-API-over-HTTP one.

## How to deploy (Canton test/Mission environment)

1. Get the participant node URL and party allocation process sorted with
   whoever's running the shared Canton testnet early — the Dev Build
   Guide is right to flag this as something you don't want to leave
   until the last day.
2. `dpm build` to get `.daml/dist/ozmium-cashflow-0.1.0.dar`.
3. Upload it to the target participant. Check `dpm --help` or your
   participant's own docs for the current upload command — this is
   where Daml 2.x's `daml ledger upload-dar` used to live.
4. Allocate real parties for PropManagerCo/BerlinSPV/investors on that
   participant instead of `Ozmium.Setup`'s demo ones, and re-run the
   equivalent of `setup` against them. Write down the resulting
   ContractIds somewhere that isn't just your terminal scrollback — a
   small config file, or query them back later via JSON API/PQS — since
   there's no key lookup to bail you out if you lose them.
5. Point `integration/mock-attestor` at the real participant, either the
   ledger host/port (Daml Script option) or the JSON API URL (Python
   option).

## Architecture decisions

### Why the regulated-attestor model, not oracle-first

Rent, loan repayments — most real-world cashflow events — are private
facts specific to one lease or loan agreement. They're not public data
like an FX rate, so there's nothing for a decentralized oracle network
to check them against. Somebody has to be the original source of truth;
an oracle can corroborate a claim, it can't discover one. And regulators
generally want a named party they can hold liable, not an anonymous set
of nodes — which happens to play to Ozmium's strength as a regulated
player anyway.

In the code: `RevenueAttestation` requires `signatory attestor`, so only
the actual attestor can ever bring one into existence — that's enforced
by the ledger itself, not something an app could get wrong.
`Attestation_Validate` then checks the claim against `AttestorRegistry`
— is this really the party registered for this asset — before it's
allowed to turn into a `ValidatedRevenueEvent` that anything downstream
can act on.

Oracle corroboration (`Oracle.daml`) sits on top of this, not instead of
it, and lives in its own module that nothing else imports. It's scoped
to bond coupon rates specifically, since that's a case where a published
rate genuinely exists to check against — real estate rent doesn't have
an equivalent.

### Why entitlement calculation is its own step

`ValidatedRevenueEvent_CalculateEntitlement` takes a `HoldingsSnapshot`
as a parameter instead of reading holdings straight off the validated
event. That's the thing keeping this chain-agnostic — swap the
manually-attested snapshot for a live CIP-56 or Hedera holdings read
later, and nothing in Attestation/Validation/Settlement has to change.
Only how the snapshot gets created is different.

### Why deductions stay itemized

`Deduction` is a list of type/amount pairs on the attestation, not one
netted number. If a servicer just handed over a pre-calculated net
figure, the waterfall logic would be invisible to the ledger and there'd
be no way to vary it per deal — which defeats the point of building this
on Canton in the first place. Keeping deductions itemized also sets up
Canton's privacy model nicely for later: you can restrict who sees
line-item fee detail versus just the net number, which came up as an
open question in the Revenue Attestation Architecture doc.

### Extending to bonds and private credit

Nothing in `Types.daml`, `Validation.daml`, `Entitlement.daml`, or
`Settlement.daml` assumes real estate specifically. `RevenueType`
already has `Coupon` and `LoanRepayment` next to `Rent`. A bond coupon
event goes through the exact same choices — attested, checked against a
registered paying agent instead of a property manager, split across
holders, settled — the only things that change are who the attestor is
and what's in the registry. `Oracle.daml`'s bond corroboration check is
already a working example of a phase-two extension living next to the
core pattern without touching it.

### Auditability

Every `SettlementInstruction` carries `sourceEventRef`, which traces
back to the attestation's original `source_reference`.
`EntitlementCalculation` keeps `attestor` as a signatory alongside
`fund`, so the whole chain — attestation, validation, entitlement,
settlement — is baked into who signed what on the ledger, not something
you'd have to go dig out of application logs.
`tests/scenarios/Checkpoint4_Settlement.daml` checks this directly: the
settlement amounts sum to exactly the validated event's net
distributable amount, and every settlement's source reference matches
the original attestation.

## Known limitations / what a next milestone would add

- Waterfall is pro-rata only — no tranches, hurdle rates, or fee-on-fee
  logic yet.
- `AttestorRegistry` is governed by one admin party. Since this is
  actually the trust root of the whole system, a real deployment
  probably wants multi-sig or a committee here, plus an actual legal
  process for onboarding attestors (also an open question in the
  Revenue Attestation Architecture doc).
- No dispute or reversal path if an attestation turns out to be wrong or
  fraudulent after settlement — right now that's legal recourse only.
- `Settlement_MarkPaid` is triggered by hand. A real build would tie
  this to an actual confirmation from the payment rail — a Hedera
  stablecoin transfer clearing, for instance.
- Duplicate-period protection depends on the caller actually passing
  `knownPriorEventCids` (see the contract keys section above). A real
  deployment needs the fund's automation to reliably check PQS/JSON API
  before every `Attestation_Validate` call — this is a genuine step down
  from what the old contract-key version guaranteed, not a stylistic
  choice, and it's worth confirming with Ozmium what the actual PQS
  integration timeline looks like rather than treating the on-ledger
  check as good enough by itself.
- Couldn't install DPM from where I'm working (no network access to
  get.digitalasset.com, GitHub, npm, anything), so none of this has
  actually been run through `dpm build`/`dpm test`. I went through the
  Daml by hand looking for anything that wouldn't fly on 3.5 — including
  a specific pass for leftover `key`/`maintainer`/`fetchByKey`/`lookupByKey`
  — but that's not a substitute for actually compiling it. Run
  `dpm build && dpm test` before you trust any of this. The
  `sdk-version: 3.5.3` pin and the `dpm sandbox`/`dpm script` flags above
  are looked-up, not tested — check them against `dpm --help` on your
  end before relying on them.
