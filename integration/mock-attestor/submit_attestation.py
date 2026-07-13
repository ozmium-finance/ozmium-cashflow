#!/usr/bin/env python3
"""
Stands in for a property manager's system sending a signed revenue event
over to Ozmium, so we don't have to run daml script commands live during
a demo.

Takes a JSON payload shaped like the schema in the Revenue Attestation
Architecture doc (asset_id, period_start/end, revenue_type, gross_amount,
currency, deductions, source_reference) and POSTs it to the Daml JSON API
as a create command for Ozmium.Attestation:RevenueAttestation.

One thing you'll notice is missing versus that draft schema: no
attestor_signature field. Don't need one — Canton already won't let this
create succeed unless it's submitted with the attestor's own authority
(see `signatory attestor` in Attestation.daml), so the JWT itself is
doing that job. A separate signature field would just be redundant.

Usage:
    python3 submit_attestation.py attestation_sample.json \\
        --fund BerlinSPV \\
        --json-api-url http://localhost:7575 \\
        --jwt-file ./propmanager.jwt

Needs the Daml JSON API running against a sandbox or participant
(`dpm sandbox --json-api-port 7575`) and a JWT that lets you act as the
attestor. See the project README for how to get a sandbox JWT locally.
"""

import argparse
import json
import sys
from datetime import datetime

import requests

TEMPLATE_ID = "Ozmium.Attestation:RevenueAttestation"

# lowercase strings in the JSON -> the RevenueType constructors in Daml
REVENUE_TYPE_MAP = {
    "rent": "Rent",
    "coupon": "Coupon",
    "loan_repayment": "LoanRepayment",
    "distribution": "Distribution",
}


def to_daml_variant(tag: str) -> dict:
    """The JSON API wants nullary variant constructors as
    {"tag": ..., "value": {}} — not just the bare string."""
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
