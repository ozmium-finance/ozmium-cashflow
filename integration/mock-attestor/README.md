# Mock Attestor

Simulates a property manager's system submitting a signed revenue event,
so the live demo doesn't depend on typing `dpm script` commands on stage
(Checkpoint 5 in the Dev Build Guide).

Two interchangeable ways to run it — pick whichever fits the demo better.
Both assume Daml 3.5.x tooling (`dpm`, not the deprecated `daml` CLI —
see the root README's "Toolchain" section).

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

Start a sandbox first (in another terminal), from the repo root:

```bash
dpm sandbox --dar .daml/dist/ozmium-cashflow-0.1.0.dar --json-api-port 7575
```

`MockAttestor.daml`'s `getOrAllocateParty` looks up `PropManagerCo`/
`BerlinSPV` by display name if `Ozmium.Setup:setup` has already been run
against this sandbox (see root README), falling back to allocating fresh
parties otherwise — either way it works standalone.

## Option B — Python over the JSON API (closer to a real integration)

Shows the "external property-management system calls into Ozmium over
HTTP" story more literally. Requires the sandbox's JSON API enabled
(`dpm sandbox --dar <dar> --json-api-port 7575`, as above) and a JWT for
the attestor party.

```bash
pip install requests
python3 submit_attestation.py attestation_sample.json \
  --fund BerlinSPV \
  --json-api-url http://localhost:7575 \
  --jwt-file ./propmanager.jwt
```

For local sandbox testing (not production!), `dpm sandbox` accepts
unsigned/test JWTs with the right claims by default. A minimal token
payload:

```json
{
  "https://daml.com/ledger-api": {
    "ledgerId": "sandbox",
    "applicationId": "mock-attestor",
    "actAs": ["PropManagerCo"]
  }
}
```

Check current Digital Asset docs (`docs.digitalasset.com`, JSON Ledger
API section) for the exact claim namespace and token format expected by
your `dpm sandbox` version — this has historically varied across SDK
versions and wasn't independently verified against a live install here.
For authenticated sandbox runs, `dpm sandbox --config auth.conf` is the
3.5.x equivalent of the old `--auth-jwt-hs256-unsafe` flag; see
`dpm sandbox --help`.

## `attestation_sample.json`

Field shape mirrors the schema drafted in the Revenue Attestation
Architecture doc. One deliberate omission: no `attestor_signature` field
— on Canton/Daml the ledger itself enforces that only the attestor party
can author a `RevenueAttestation` (see `signatory attestor` in
`Attestation.daml`), so the JWT/party authority used to submit the
command *is* the signature. A bolt-on signature field would just
duplicate what the ledger already guarantees structurally.

## No contract keys

If you're wiring this into a real attestation pipeline: there's no
`AttestorRegistry`/`ValidatedRevenueEvent` lookup-by-key available on
Canton 3.x. Your automation layer needs to track the relevant
ContractIds itself (from create/exercise results, or by querying the
JSON API/PQS) — see the root README's "Contract keys and Canton 3.x"
section for the full explanation and the `knownPriorEventCids` mechanism
this integration should feed when calling `Attestation_Validate`.
