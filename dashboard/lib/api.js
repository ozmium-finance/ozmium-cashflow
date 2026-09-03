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

// Full-history CreatedEvents (including ones for contracts that have
// since been archived) -- for tracing a settlement back to its source
// attestation. Every step in the attestation -> validate -> distribute
// -> entitlement -> settle pipeline is a *consuming* choice, so by the
// time a SettlementInstruction exists, every upstream contract in its
// chain has already been archived and dropped out of active-contracts.
// fetchActiveContracts can never find them; only the transaction stream
// (which keeps a record of archived contracts, not just current state)
// can. See audit.js.
//
// Deliberately scoped to filtersByParty for this app's own known
// parties rather than filtersForAnyParty's wildcard -- learned earlier
// today that a wildcard scan against a busy shared devnet (rather than
// the small local sandbox this was first built against) means paging
// through everything anyone else on the node has ever done. Scoping to
// parties we actually allocated keeps this to just our own history.
export async function fetchHistoricalCreates() {
  const parties = listOwnKnownParties();
  if (parties.length === 0) return [];

  const end = await apiFetch("/v2/state/ledger-end");
  const filtersByParty = {};
  for (const p of parties) {
    filtersByParty[p] = {
      cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
    };
  }
  // Canton's own error on the first attempt at this (an eventFormat
  // field, matching active-contracts' shape) was explicit: "Either
  // filter/verbose or updateFormat is required" -- this endpoint takes
  // the older, simpler filter+verbose pair active-contracts *doesn't*
  // use, not eventFormat. Kept beginExclusive/endInclusive as numbers to
  // match active-contracts' activeAtOffset convention on this participant.
  const query = {
    beginExclusive: 0,
    endInclusive: end.offset,
    verbose: false,
    filter: { filtersByParty, filtersForAnyParty: null },
  };
  const rows = await apiFetch("/v2/updates/flats", query);

  const events = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    // Defensive about wrapper shape, same reasoning as fetchActiveContracts
    // -- haven't been able to confirm the exact envelope for this
    // endpoint against this participant version ahead of time the way
    // active-contracts was already proven.
    const tx = r.update?.Transaction?.value ?? r.Transaction?.value ?? r.transaction ?? r;
    const txEvents = tx?.events ?? [];
    for (const e of txEvents) {
      const created = e.CreatedEvent?.value ?? e.CreatedEvent ?? e.createdEvent;
      if (created) events.push(created);
    }
  }
  return events;
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

// Resolves a DFNS walletId to its current on-chain address -- needed
// because AddressBookEntry (Ozmium.AddressBook) only ever stores the
// walletId, never the address, so anything that wants to actually send
// to an investor's wallet has to look this up live.
export async function getDfnsWallet(walletId) {
  return apiFetch(`/dfns/get-wallet?walletId=${encodeURIComponent(walletId)}`);
}

// Week 4 -- the real settlement rail. Routed through /api/dfns/transfer-
// cip56 (server-side, keeps DFNS credentials off the browser, same
// reasoning as createDfnsWallet above). walletId/instrumentId/
// instrumentAdmin are optional here -- when omitted the API route falls
// back to the fund/treasury wallet and OZM's own CIP-56 identifiers
// configured server-side (DFNS_ISSUER_WALLET_ID /
// DFNS_OZM_INSTRUMENT_ID / DFNS_OZM_INSTRUMENT_ADMIN).
export async function transferCip56Asset({ walletId, instrumentAdmin, instrumentId, to, toWalletId, amount, externalId }) {
  return apiFetch("/dfns/transfer-cip56", { walletId, instrumentAdmin, instrumentId, to, toWalletId, amount, externalId });
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

// Learned the hard way: even a *distinctive* fixed hint isn't enough to
// avoid the search fallback forever -- clear the party cache (browser
// data wipe, or just testing) and the next allocate collides with the
// party this exact browser already made, right back into paging through
// devnet's huge unrelated party list. A per-browser random suffix, generated
// once and kept separately from the resolved-party cache, means every
// hint this browser ever asks for is fresh from the very first attempt --
// create just succeeds, no collision, no search. The suffix key is only
// ever cleared by wiping site data entirely, at which point a brand new
// (still fresh) suffix is fine too.
const PARTY_SUFFIX_KEY = "ozmium-party-suffix-v1";

function getPartySuffix() {
  if (typeof window === "undefined") return "local";
  try {
    let suffix = window.localStorage.getItem(PARTY_SUFFIX_KEY);
    if (!suffix) {
      suffix = Math.random().toString(36).slice(2, 8);
      window.localStorage.setItem(PARTY_SUFFIX_KEY, suffix);
    }
    return suffix;
  } catch {
    return "local";
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
// first, no network round trip), otherwise allocate fresh. The actual
// on-chain partyIdHint is this browser's suffixed version (see
// getPartySuffix above), so create essentially always succeeds on the
// first try -- the cache below is keyed by the plain, unsuffixed hint,
// so callers never see the suffix at all.
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

  const uniqueHint = `${hint}-${getPartySuffix()}`;

  try {
    const created = await apiFetch("/v2/parties", { partyIdHint: uniqueHint });
    const party = created.partyDetails.party;
    await grantActAs(party);
    cacheParty(hint, party);
    return party;
  } catch (err) {
    if (!/already exists/i.test(err.message)) throw err;
    // Only reachable if this exact browser+suffix already made this
    // exact party (e.g. a grant/cache-write failed after a create that
    // itself succeeded) -- a narrow, rare case, unlike searching for a
    // bare hint against devnet's entire unrelated party list.
    const found = await searchForParty(uniqueHint);
    if (found) {
      await grantActAs(found);
      cacheParty(hint, found);
      return found;
    }
    throw err;
  }
}

// Used to be a full ledger-wide GET /v2/parties (paginated) -- fine
// against the local dpm sandbox, which only ever had this app's own
// handful of parties on it, but on devnet that's every party any
// project sharing the node has ever allocated (tens of thousands), with
// no way to tell which ones are ours. investor.js used this to build
// its "pick which investor you are" dropdown and defaulted to the
// first result -- meaning it was defaulting to some unrelated party
// from a completely different project the moment devnet mode went
// live. What that dropdown actually needs is just the parties *this*
// app allocated, which is exactly what's already sitting in the
// getOrAllocateParty cache -- no ledger round trip required at all.
export function listOwnKnownParties() {
  return Object.values(loadPartyCache());
}

// [hint, party] pairs instead of just party ids -- lets a caller pick a
// smarter default than "whichever got allocated first" (which is Admin,
// since stepSetup allocates it before any investor).
export function listOwnKnownPartyEntries() {
  return Object.entries(loadPartyCache());
}
