# Mock Attestor

Stands in for a property manager's system sending in a signed revenue
event, so we're not typing `dpm script` commands live on stage
(Checkpoint 5 in the Dev Build Guide).

Two ways to run it, pick whichever fits. Both assume Daml 3.5.x tooling
(`dpm`, not the old `daml` CLI — see "Toolchain" in the root README).

## Option A — Daml Script (fastest, no extra setup)

```bash
# from the repo root, once:
dpm build

cd integration/mock-attestor
dpm build
dpm script \
  --dar .daml/dist/ozmium-mock-attestor-0.1.0.dar \
  --script-name MockAttestor:runMockAttestation \
  --ledger-host localhost --ledger-port 6865
```

Start a sandbox first, in another terminal, from the repo root:

```bash
dpm sandbox --dar .daml/dist/ozmium-cashflow-0.3.0.dar --json-api-port 7575
```

`getOrAllocateParty` in `MockAttestor.daml` looks for `PropManagerCo`/
`BerlinSPV` by name if `Ozmium.Setup:setup` already ran on this sandbox,
and allocates them fresh if not. Works either way, no extra setup needed.

## Option B — Python over the JSON API (closer to a real integration)

This one actually shows the "external system calls into Ozmium over
HTTP" story instead of just asserting it. Needs the sandbox's JSON API
turned on (`dpm sandbox --dar <dar> --json-api-port 7575`, same as
above) plus a JWT for the attestor party.

```bash
pip install requests
python3 submit_attestation.py attestation_sample.json \
  --fund BerlinSPV \
  --json-api-url http://localhost:7575 \
  --jwt-file ./propmanager.jwt
```

For local testing, `dpm sandbox` will accept unsigned test JWTs with the
right claims. Minimal payload:

```json
{
  "https://daml.com/ledger-api": {
    "ledgerId": "sandbox",
    "applicationId": "mock-attestor",
    "actAs": ["PropManagerCo"]
  }
}
```

That `https://daml.com/ledger-api` key isn't a real link, by the way —
it's just how the claim gets namespaced in the JWT, same idea as an XML
namespace URI. Don't go looking for a page there.

Worth double-checking this against current Digital Asset docs
(`docs.digitalasset.com`, JSON Ledger API section) since the exact claim
format has moved around across SDK versions and I couldn't verify it
against a live install from here. For authenticated runs,
`dpm sandbox --config auth.conf` replaces the old
`--auth-jwt-hs256-unsafe` flag — check `dpm sandbox --help`.

## `attestation_sample.json`

Shaped like the schema in the Revenue Attestation Architecture doc, with
one thing left out on purpose: no `attestor_signature` field. Canton
already enforces that only the attestor can create a `RevenueAttestation`
(`signatory attestor` in `Attestation.daml`), so the JWT you're
authenticating with already does that job — a signature field on top
would just be duplicating what the ledger guarantees for free.

## No contract keys

If you end up wiring this into something real: there's no key-based
lookup for `AttestorRegistry` or `ValidatedRevenueEvent` on Canton 3.x.
Whatever's automating this needs to keep track of ContractIds itself —
from create/exercise results, or by querying the JSON API/PQS. See
"Contract keys and Canton 3.x" in the root README for the full story and
what `knownPriorEventCids` is for when calling `Attestation_Validate`.
