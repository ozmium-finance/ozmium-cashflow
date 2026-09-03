// Server-only. Never import this from a component or anything that ships
// to the browser -- it constructs a client authenticated with the DFNS
// service account's private key and long-lived auth token, both read
// straight from process.env (see .env.local.example). Next.js API routes
// run server-side only, so pages/api/dfns/*.js importing this is safe;
// nothing here is bundled into client JS.
//
// Uses DFNS's own SDK (@dfns/sdk + @dfns/sdk-keysigner) rather than
// hand-rolling the request-signing protocol against curl the way the
// Canton JSON API proxy does -- DFNS's mutating endpoints (like Create
// Wallet) require "User Action Signing", a challenge/response scheme, and
// there's no good reason to reimplement that by hand when DFNS publishes
// a maintained client that already does it correctly.
import { DfnsApiClient } from "@dfns/sdk";
import { AsymmetricKeySigner } from "@dfns/sdk-keysigner";

let cachedClient = null;

export function getDfnsClient() {
  if (cachedClient) return cachedClient;

  const rawKeyB64 = process.env.DFNS_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || "";
  const credId = process.env.DFNS_CREDENTIAL_ID || "";
  const orgId = process.env.DFNS_ORG_ID || "";
  const authToken = process.env.DFNS_SERVICE_ACCOUNT_AUTH_TOKEN || "";
  const baseUrl = process.env.DFNS_API_URL || "https://api.dfns.io";

  const privateKey = Buffer.from(rawKeyB64, "base64").toString("utf8");

  const signer = new AsymmetricKeySigner({
    credId,
    privateKey,
  });

  cachedClient = new DfnsApiClient({
    baseUrl,
    orgId,
    authToken,
    signer,
  });
  return cachedClient;
}

// Creates a real DFNS-custodied wallet on CantonTestnet -- not Canton
// mainnet, matching every other "devnet"-scoped credential in this repo.
// externalId is where the investor's actual Canton PartyID goes, so the
// wallet itself carries a durable, queryable link back to who it's for,
// on top of whatever AddressBookEntry records on the Canton ledger side.
export async function createCantonTestnetWallet({ name, externalId }) {
  const wallet = await getDfnsClient().wallets.createWallet({
    body: {
      network: "CantonTestnet",
      name,
      externalId,
    },
  });
  // Per DFNS's own Canton docs: a freshly created wallet "has a key but is
  // not yet registered on any validator. The wallet address will not have
  // a prefix and the wallet cannot be used for transactions yet." Activate
  // it immediately against DFNS_CANTON_VALIDATOR_ID so callers always get
  // back a usable, fully-prefixed address -- without this, every wallet
  // this app creates silently can't send or receive until someone notices
  // and activates it by hand. If the validator isn't configured yet, fall
  // back to returning the unactivated wallet rather than failing wallet
  // creation outright -- this repo may still be waiting on BYOV setup.
  if (process.env.DFNS_CANTON_VALIDATOR_ID) {
    return activateCantonWallet({ walletId: wallet.id });
  }
  return wallet; // { id, network, address, status, ... } -- address has no prefix yet
}

// Registers a wallet on DFNS_CANTON_VALIDATOR_ID (the "Activate Wallet"
// step DFNS's Canton docs describe as required before a wallet's address
// carries its full "<hint>::1220<hash>" prefix and can send/receive at
// all). Activation is asynchronous on DFNS's side, so this polls
// getWallet afterward rather than trusting the activateWallet response --
// that response is just a transaction id, not the updated wallet.
export async function activateCantonWallet({ walletId }) {
  const validatorId = process.env.DFNS_CANTON_VALIDATOR_ID;
  if (!validatorId) {
    throw new Error("DFNS_CANTON_VALIDATOR_ID isn't configured -- can't activate a Canton wallet without knowing which validator to register it on (see .env.local.example)");
  }
  await getDfnsClient().wallets.activateWallet({
    walletId,
    body: { validatorId },
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const wallet = await getDfnsClient().wallets.getWallet({ walletId });
    if (wallet.address && wallet.address.includes("::")) return wallet;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Wallet ${walletId} still has no fully-prefixed address ~15s after activation -- it may still be registering on the validator, try again shortly`);
}

// Diagnostic helper -- the DFNS Dashboard's Canton Validators page (Settings
// > Developers > Canton validators) lists validators by name but doesn't
// surface their id (cv-xxxxx-xxxxx-...) anywhere in that UI, which is the
// one thing DFNS_CANTON_VALIDATOR_ID actually needs. This hits the same
// data DFNS's own "List Canton Validators" API returns, using the
// credentials already configured server-side, so the id can be read off
// directly instead of guessing at hidden dashboard affordances.
// Queries all three Canton network variants -- canton-testnet is what
// createCantonTestnetWallet actually uses, but the validator itself could
// have been linked under a different one (e.g. canton-devnet), which
// would itself explain an empty result and be worth knowing.
export async function listCantonValidators() {
  const networks = ["canton-testnet", "canton-devnet", "canton"];
  const byNetwork = {};
  for (const network of networks) {
    const result = await getDfnsClient().networks.listCantonValidators({ network });
    byNetwork[network] = result.items || [];
  }
  return byNetwork;
}

// Looks up a wallet by id -- mainly to resolve its on-chain `address`,
// since Settlement.daml/AddressBookEntry only ever store the DFNS
// walletId (a `wa-...` id), never the address itself. Re-fetching this
// live rather than caching it anywhere on the Canton side keeps the
// wallet's actual current address as the single source of truth --
// there's no rotation story to keep in sync otherwise.
//
// Self-heals wallets created before activation was wired into
// createCantonTestnetWallet above (or where activation never completed):
// a bare, unprefixed address always fails DFNS's own destination-address
// pattern on a real transfer, so activate on demand instead of leaving
// that to surface downstream as a cryptic "Request body failed validation".
export async function getCantonTestnetWallet(walletId) {
  const wallet = await getDfnsClient().wallets.getWallet({ walletId });
  if (wallet.address && !wallet.address.includes("::") && process.env.DFNS_CANTON_VALIDATOR_ID) {
    return activateCantonWallet({ walletId });
  }
  return wallet;
}

// Week 4 -- the actual settlement rail. CIP-56 is Canton's own token
// standard, and DFNS has native support for it (`kind: "Cip56"` on
// transferAsset) -- so "wire CIP-56 and DFNS together" doesn't mean
// hand-rolling a new holding/transfer contract on the Canton ledger, it
// means calling this. instrumentId/instrumentAdmin identify which
// CIP-56 instrument to move (the OZM token's own identifiers, set once
// wherever OZM was actually registered/minted -- see
// DFNS_OZM_INSTRUMENT_ID/DFNS_OZM_INSTRUMENT_ADMIN in .env.local); `to`
// is the destination wallet's on-chain address (resolve via
// getCantonTestnetWallet first, AddressBookEntry only has a walletId).
//
// externalId is the idempotency key DFNS itself enforces -- passing a
// SettlementInstruction's own contract id here means retrying a failed
// or ambiguous call can never double-pay the same instruction, without
// this app needing to invent its own dedupe bookkeeping.
//
// Per DFNS's Canton docs, a direct Cip56 transfer (offer: false, the
// default) "settles immediately with no acceptance step, but only if the
// recipient has a transfer pre-approval for that token. If they do not,
// the request is rejected with a message to create an offer instead."
// Pre-approving OZM requires broadcasting a raw Canton transaction against
// the Registry Utility's own TransferPreapproval template -- template IDs
// and field names this repo doesn't have configured, and specific to
// whatever Registry Utility version issued OZM. Until that's wired up,
// this always sends offer: true instead, then auto-accepts the resulting
// offer server-side (both the issuer treasury wallet and every investor
// wallet in this demo are DFNS-custodied under the same org, so nothing
// stops this app from accepting on the recipient's behalf the same way a
// human would click "Accept" on the DFNS dashboard).
export async function transferCip56Asset({
  walletId,
  instrumentAdmin,
  instrumentId,
  to,
  toWalletId,
  amount,
  externalId,
}) {
  // Self-heal the source wallet too -- DFNS won't let an unactivated
  // wallet send at all, not just fail address-pattern validation on `to`.
  await getCantonTestnetWallet(walletId);

  const transfer = await getDfnsClient().wallets.transferAsset({
    walletId,
    body: {
      kind: "Cip56",
      instrumentAdmin,
      instrumentId,
      to,
      amount,
      externalId,
      offer: true,
    },
  });

  if (toWalletId) {
    await acceptPendingCip56Offer({ walletId: toWalletId, to, amount });
  }

  return transfer; // { id, status, txHash, ... } -- status starts Pending/Executing, not necessarily Confirmed yet
}

// Polls the recipient wallet's offers for the one this transfer just
// created and accepts it. offer: true means the transfer doesn't settle
// on its own -- DFNS docs: "the recipient explicitly accepts the offer."
// listOffers doesn't take externalId/transfer id as a filter, so this
// matches on destination address + amount among Pending offers, which is
// unambiguous for this demo's one-settlement-at-a-time flow.
async function acceptPendingCip56Offer({ walletId, to, amount }) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { items } = await getDfnsClient().wallets.listOffers({ walletId, query: { limit: 20 } });
    const match = (items || []).find((o) => o.status === "Pending" && o.to === to && o.value === amount);
    if (match) {
      await getDfnsClient().wallets.acceptOffer({ walletId, offerId: match.id });
      return match.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`CIP-56 transfer offer to ${to} for ${amount} never appeared in listOffers for wallet ${walletId} after ~12s -- it may need to be accepted manually via the DFNS dashboard`);
}

// SettlementInstruction.amount comes off the Canton ledger as a plain
// decimal string (e.g. "50000.0000000000" -- Daml's Decimal, fixed at
// scale 10). DFNS's transferAsset wants the amount in the token's own
// minimum denomination (an integer string, same idea as wei for ETH),
// which depends on however many decimals OZM's CIP-56 instrument was
// actually registered with -- that's config this repo doesn't know
// (DFNS_OZM_DECIMALS), not something to guess at. String-based on
// purpose, not parseFloat/Math.round -- floating point on a real token
// amount is exactly the kind of bug that's silent until it isn't.
export function toMinimumDenomination(amountStr, decimals) {
  const str = String(amountStr).trim();
  const negative = str.startsWith("-");
  const unsigned = negative ? str.slice(1) : str;
  const [whole, frac = ""] = unsigned.split(".");
  if (frac.length > decimals) {
    // Refuse to silently truncate real precision rather than round it
    // away -- a caller passing more fractional digits than the
    // instrument actually supports almost certainly has the wrong
    // decimals configured.
    throw new Error(`Amount "${amountStr}" has more fractional digits than decimals=${decimals} supports`);
  }
  const fracPadded = frac.padEnd(decimals, "0");
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");
  return negative ? `-${combined}` : combined;
}
