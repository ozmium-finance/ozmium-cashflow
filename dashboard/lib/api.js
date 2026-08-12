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

// devnet is a large *shared* participant -- other builds, other
// people's testing, DFNS/CIP-56 work, whatever else runs against the
// same node -- and ListKnownParties has no server-side filter, only
// pageSize/pageToken. In practice that list is tens of thousands of
// entries long, almost all of them auto-generated hex/UUID-style hints
// (leading chars '0'-'9'/'a'-'f'). Searching it top-to-bottom for one
// hint by paging through everything ahead of it is impractical -- a
// 20-page cap found nothing, and there's no cap short of "page through
// the whole node" that's actually guaranteed to reach a given hint.
//
// So this no longer searches-then-creates. It remembers party ids this
// browser has already resolved (localStorage, keyed by hint) and, on a
// cache miss, just tries to allocate -- which is one cheap request, not
// a scan. The only case that still needs a bounded search is a genuine
// "already exists" reply, and even then it only needs to search for the
// *one* hint that just collided, not pre-scan for all of them.
const PARTY_CACHE_KEY = "ozmium-known-parties-v1";

function loadPartyCache() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PARTY_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function cacheParty(hint, party) {
  if (typeof window === "undefined") return;
  try {
    const cache = loadPartyCache();
    cache[hint] = party;
    window.localStorage.setItem(PARTY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full/unavailable -- non-fatal, we'll just re-resolve next time.
  }
}

// Every hint this app uses (Admin, PropManagerCo, BerlinSPV,
// InvestorAlice/Bob/Carol, OzmiumIssuer) starts with an uppercase
// letter. Parties come back sorted by their full id string, and almost
// everything else on this shared node sorts either before ours (digits)
// or after (lowercase hex/UUID hints) -- so once a page's entries have
// moved past the uppercase range (> 'Z', 0x5A), nothing on any later
// page can still match, and it's safe to stop instead of paging through
// the rest of a very large, unrelated tail.
function pastUppercaseRange(partyId) {
  return partyId.charCodeAt(0) > 0x5a;
}

async function searchForParty(hint, maxPages = 100) {
  let pageToken = "";
  for (let i = 0; i < maxPages; i++) {
    const qs = pageToken ? `?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}` : "?pageSize=1000";
    const res = await apiFetch(`/v2/parties${qs}`);
    const list = res.partyDetails || res || [];
    for (const p of list) {
      const id = p.party || p;
      if (String(id).includes(hint)) return id;
    }
    if (list.length > 0 && pastUppercaseRange(list[list.length - 1].party || list[list.length - 1])) break;
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return null;
}

// Canton has no wildcard CanActAs (unlike CanReadAsAnyParty) -- per
// Five North, it's granted per party, and has to happen after the party
// exists (via /v2/users/{userId}/rights, self-granted since this app's
// devnet identity has ParticipantAdmin -- see pages/api/grant-act-as.js).
// Every party this app will ever submitCommand as has to go through
// this once. A no-op outside devnet mode (grant-act-as.js just skips).
async function grantActAs(party) {
  const res = await fetch("/api/grant-act-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ party }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`grant-act-as -> HTTP ${res.status}\n${text}`);
  }
}

// Mirrors MockAttestor.daml's getOrAllocateParty -- reuse an existing
// party for this hint if we've already resolved one (checked locally
// first, no network round trip), otherwise allocate fresh. A "party
// already exists" reply on create only happens for hints from earlier
// testing sessions predating this cache -- handled by one bounded
// search for just that hint, not a full pre-scan on every call.
//
// Every path that resolves a *new-to-this-cache* party id also grants
// it CanActAs before returning -- allocating (or discovering) a party
// isn't enough to submit commands as it. Once a hint is cached, the
// grant has already happened at some earlier point and doesn't need
// repeating (rights are permanent participant-side state, not tied to
// this browser).
export async function getOrAllocateParty(hint) {
  const cached = loadPartyCache()[hint];
  if (cached) return cached;

  try {
    const created = await apiFetch("/v2/parties", { partyIdHint: hint });
    const party = created.partyDetails.party;
    await grantActAs(party);
    cacheParty(hint, party);
    return party;
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
    const found = await searchForParty(hint);
    if (found) {
      await grantActAs(found);
      cacheParty(hint, found);
      return found;
    }
    throw err;
  }
}

export async function listKnownParties() {
  const all = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const qs = pageToken ? `?pageSize=1000&pageToken=${encodeURIComponent(pageToken)}` : "?pageSize=1000";
    const res = await apiFetch(`/v2/parties${qs}`);
    const list = res.partyDetails || res || [];
    if (Array.isArray(list)) all.push(...list);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return all.map((p) => p.party || p);
}
