// Client-side mirror of Ozmium.ProofLog's hash-chain logic (see
// daml/Ozmium/ProofLog.daml) -- written to match it exactly, field for
// field, so a page running in a browser can verify a chain the same
// way verifyChain does on-ledger, without needing to trust this app's
// own server to have checked it first. That's the whole point of the
// public verification page (pages/verify.js) -- see its own header
// comment for the "why a plain function, not an API call" reasoning,
// which is the same reasoning ProofLog.daml's own verifyChain gives.
//
// Shared between here and components/DemoPanel.js (which computes
// payloadHash the same way when it appends a real entry) so both sides
// of "hash this the same way" live in exactly one place, not two
// copies that can quietly drift apart.

// Mirrors DA.Crypto.Text.sha256(toHex(...)): toHex hex-encodes a
// Text's UTF-8 bytes, and sha256 hashes those hex-decoded bytes and
// returns the digest as hex -- net effect is just
// hex(SHA256(utf8 bytes of the string)), which Web Crypto gives
// directly without needing to touch the intermediate hex-of-input step
// at all.
export async function sha256HexOfUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Mirrors Ozmium.ProofLog.nextEntryHash exactly:
// sha256(toHex(previousHash <> eventRef <> payloadHash)).
export async function nextEntryHash(previousHash, eventRef, payloadHash) {
  return sha256HexOfUtf8(previousHash + eventRef + payloadHash);
}

// Same canonical, pipe-delimited field ordering
// Checkpoint11_ProofLogSettlement.daml's canonicalSettlementRecord uses
// on the Daml-test side -- documented once, mirrored on every side so
// "hash my own settlement record" means the same thing no matter where
// it's computed. `a` is a SettlementInstruction's createArgument (or
// any plain object with the same field names -- e.g. a downloaded
// statement, see pages/investor.js).
export function canonicalSettlementRecord(a) {
  return [a.fund, a.holder, a.assetId, a.periodStart, a.periodEnd, a.currency, a.amount, a.sourceEventRef, a.dfnsTransferId || ""].join("|");
}

// Mirrors Ozmium.ProofLog.verifyChain exactly: genesis must have
// previousHash "" and a correctly-computed entryHash, and every
// subsequent entry's previousHash must equal the prior entry's
// entryHash, with its own entryHash also correctly computed. Expects
// entries already sorted by sequenceNo ascending -- same "caller sorts
// first" contract the Daml version's own comment documents.
//
// Returns which index broke (if any) rather than just true/false --
// unlike the Daml version, this one's driving a UI that wants to point
// at the specific entry, not just report pass/fail.
export async function verifyChainDetailed(entries) {
  if (entries.length === 0) return { ok: true, brokenAt: null };

  const genesis = entries[0];
  if (genesis.previousHash !== "") return { ok: false, brokenAt: 0, reason: "genesis entry's previousHash isn't empty" };
  const genesisExpected = await nextEntryHash(genesis.previousHash, genesis.eventRef, genesis.payloadHash);
  if (genesisExpected !== genesis.entryHash) return { ok: false, brokenAt: 0, reason: "genesis entryHash doesn't match its own inputs" };

  let prev = genesis;
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e.previousHash !== prev.entryHash) {
      return { ok: false, brokenAt: i, reason: `entry #${e.sequenceNo}'s previousHash doesn't match entry #${prev.sequenceNo}'s entryHash -- reordered or a prior entry was dropped` };
    }
    const expected = await nextEntryHash(e.previousHash, e.eventRef, e.payloadHash);
    if (expected !== e.entryHash) {
      return { ok: false, brokenAt: i, reason: `entry #${e.sequenceNo}'s entryHash doesn't match its own inputs -- forged or tampered` };
    }
    prev = e;
  }
  return { ok: true, brokenAt: null };
}
