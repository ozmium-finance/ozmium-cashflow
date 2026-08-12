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
  return wallet; // { id, network, address, status, ... }
}
