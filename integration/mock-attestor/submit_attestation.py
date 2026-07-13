#!/usr/bin/env python3
"""
Mock attestor — simulates a property manager's system submitting a signed
revenue event to Ozmium's Canton participant, so the demo doesn't rely on
manually running `daml script` commands live (Checkpoint 5, Dev Build
Guide).

Reads a JSON payload shaped like the attestation schema drafted in the
Revenue Attestation Architecture doc (asset_id, period_start/end,
revenue_type, gross_amount, currency, deductions, source_reference) and
POSTs it to the Daml JSON API as a `create` command for
Ozmium.Attestation:RevenueAttestation.

One deliberate difference from the draft schema: there is no
`attestor_signature` field here. On Canton/Daml the ledger itself will
only let this create command succeed if it is submitted with the
attestor party's own authority (see `signatory attestor` in
Attestation.daml) — the JWT used to call the JSON API *is* the signature.
A separate signature field would be redundant with what the ledger
already enforces structurally.

Usage:
    python3 submit_attestation.py attestation_sample.json \\
        --fund BerlinSPV \\
        --json-api-url http://localhost:7575 \\
        --jwt-file ./propmanager.jwt

Requires the Daml JSON API to be running against a sandbox or Canton
participant (`dpm sandbox --json-api-port 7575`) and a JWT authorizing
the attestor party to act. See the project README for how to obtain a
sandbox JWT for local testing.
"""

import argparse
import json
import sys
from datetime import datetime

import requests

TEMPLATE_ID = "Ozmium.Attestation:RevenueAttestation"

# Maps the mock attestor's lowercase revenue_type strings onto the
# RevenueType constructors defined in Ozmium.Types.
REVENUE_TYPE_MAP = {
    "rent": "Rent",
    "coupon": "Coupon",
    "loan_repayment": "LoanRepayment",
    "distribution": "Distribution",
}


def to_daml_variant(tag: str) -> dict:
    """Nullary Daml variant constructors encode as {"tag": ..., "value": {}}
    in the JSON API."""
    return {"tag": tag, "value": {}}


def build_create_payload(event: dict, attestor: str, fund: str) -> dict:
    revenue_type = REVENUE_TYPE_MAP.get(event["revenue_type"].lower(), "Other")

    deductions = [
        {"deductionType": d["type"], "amount": str(d["amount"])}
        for d in event.get("deductions", [])
    ]

    return {
        "templateId": TEMPLATE_ID,
        "payload": {
            "attestor": attestor,
            "fund": fund,
            "assetId": event["asset_id"],
            "revenueType": to_daml_variant(revenue_type),
            "periodStart": event["period_start"],
            "periodEnd": event["period_end"],
            "grossAmount": str(event["gross_amount"]),
            "currency": event["currency"],
            "deductions": deductions,
            "sourceRef": event["source_reference"],
        },
    }


def submit(json_api_url: str, jwt: str, payload: dict) -> dict:
    response = requests.post(
        f"{json_api_url.rstrip('/')}/v1/create",
        headers={
            "Authorization": f"Bearer {jwt}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("event_file", help="Path to an attestation JSON payload")
    parser.add_argument("--attestor", default=None,
                         help="Attestor party id (defaults to attestor_id in the event file)")
    parser.add_argument("--fund", required=True, help="Fund/SPV party id")
    parser.add_argument("--json-api-url", default="http://localhost:7575")
    parser.add_argument("--jwt-file", required=True,
                         help="Path to a file containing the attestor's JSON API JWT")
    args = parser.parse_args()

    with open(args.event_file) as f:
        event = json.load(f)

    with open(args.jwt_file) as f:
        jwt = f.read().strip()

    attestor = args.attestor or event["attestor_id"]
    payload = build_create_payload(event, attestor, args.fund)

    print(f"Submitting attestation for {event['asset_id']} "
          f"({event['period_start']} - {event['period_end']}) as {attestor}...")
    result = submit(args.json_api_url, jwt, payload)

    contract_id = result.get("result", {}).get("contractId", "<unknown>")
    print(f"Created RevenueAttestation contract: {contract_id}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    return 0


if __name__ == "__main__":
    sys.exit(main())
