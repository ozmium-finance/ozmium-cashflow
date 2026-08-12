// All calls go through /api/v2/... (this app's own API route) instead of
// hitting the Canton JSON API directly -- same-origin, so there's no CORS
// to work around (dpm sandbox's JSON API sends no
// Access-Control-Allow-Origin header, learned the hard way with the old
// plain-HTML dashboard).
const API_BASE = "/api";

export async function apiFetch(path, body) {
  const res = await fetch(API_BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Canton's JSON API error body is usually { code, cause, ... } --
    // surface `cause` right in the first line when we can parse it, so
    // the demo log (which only shows the first line, to stay compact)
    // still shows the actual reason instead of just a bare status code.
    let cause = "";
    try {
      const parsed = JSON.parse(text);
      if (parsed?.cause) cause = `: ${parsed.cause}`;
    } catch {
      // Not JSON (or empty) -- fall back to just the status line below.
    }
    throw new Error(`${path} -> HTTP ${res.status}${cause}\n${text}`);
  }
  return res.json();
}

// Operator-board style query: every party, wildcard filter. Used by the
// Operator pipeline view and the Audit trail page.
export async function fetchActiveContracts() {
  const end = await apiFetch("/v2/state/ledger-end");
  const query = {
    eventFormat: {
      filtersByParty: {},
      filtersForAnyParty: {
        cumulative: [
          { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
        ],
      },
      verbose: false,
    },
    verbose: false,
    activeAtOffset: end.offset,
  };
  const rows = await apiFetch("/v2/state/active-contracts", query);
  // Response is a list of envelope objects, each wrapping a contractEntry
  // -> JsActiveContract -> createdEvent. Handle a couple of shapes
  // defensively, same as the old dashboard did.
  return (Array.isArray(rows) ? rows : [])
    .map((r) => r.contractEntry?.JsActiveContract?.createdEvent
      ?? r.createdEvent
      ?? r.contractEntry?.createdEvent)
    .filter(Boolean);
}

// Investor-view style query: filtered to a single party instead of the
// operator's wildcard, so results are genuinely scoped at the ledger
// level for contracts where that party is the only observer.
export async function fetchActiveContractsForParty(partyId) {
  const end = await apiFetch("/v2/state/ledger-end");
  const query = {
    eventFormat: {
      filtersByParty: {
        [partyId]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] },
      },
      filtersForAnyParty: null,
      verbose: false,
    },
    verbose: false,
    activeAtOffset: end.offset,
  };
  const rows = await apiFetch("/v2/state/active-contracts", query);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => r.contractEntry?.JsActiveContract?.createdEvent
      ?? r.createdEvent
      ?? r.contractEntry?.createdEvent)
    .filter(Boolean);
}

// Real DFNS wallet creation (CantonTestnet), routed through this app's
// own /api/dfns/create-wallet -- same same-origin/no-CORS reasoning as
// API_BASE above, plus it keeps the DFNS service account's credentials
// server-side only (see lib/dfnsServer.js).
export async function createDfnsWallet(name, externalId) {
  return apiFetch("/dfns/create-wallet", { name, externalId });
}

export function matchStage(templateId, stageTemplate) {
  return typeof templateId === "string" && templateId.endsWith(":" + stageTemplate);
}

export async function knownCidsFor(templateSuffix) {
  const events = await fetchActiveContracts();
  return new Set(events.filter((ev) => matchStage(ev.templateId, templateSuffix)).map((ev) => ev.contractId));
}

export async function findNewContracts(templateSuffix, knownCids) {
  const events = await fetchActiveContracts();
  return events.filter((ev) => matchStage(ev.templateId, templateSuffix) && !knownCids.has(ev.contractId));
}

let commandCounter = 0;
export function newCommandId() {
  commandCounter += 1;
  return `dashboard-${Date.now()}-${commandCounter}`;
}

export async function submitCommand(actAs, commands) {
  return apiFetch("/v2/commands/submit-and-wait", {
    commands,
    actAs: [actAs],
    userId: "ozmium-dashboard",
    commandId: newCommandId(),
  });
}

// Mirrors MockAttestor.daml's getOrAllocateParty -- reuse an existing
// party whose id contains this hint if one's already on the ledger (so
// clicking Setup twice doesn't spawn duplicate party sets), otherwise
// allocate a fresh one.
export async function getOrAllocateParty(hint) {
  const res = await apiFetch("/v2/parties");
  const list = res.partyDetails || res || [];
  const found = Array.isArray(list) ? list.find((p) => String(p.party || p).includes(hint)) : null;
  if (found) return found.party || found;
  const created = await apiFetch("/v2/parties", { partyIdHint: hint });
  return created.partyDetails.party;
}

export async function listKnownParties() {
  const res = await apiFetch("/v2/parties");
  const list = res.partyDetails || res || [];
  if (!Array.isArray(list)) return [];
  return list.map((p) => p.party || p);
}
