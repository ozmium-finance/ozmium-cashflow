// Server-only devnet auth helpers, shared between the general JSON API
// proxy (pages/api/v2/[...path].js) and the grant-act-as route
// (pages/api/grant-act-as.js) -- both need the same client-credentials
// token against the same Authentik provider, so the token cache has to
// be shared too rather than each route fetching (and rate-limiting
// itself against) a separate one.
import { spawn } from "child_process";

export const LEDGER_API_URL = process.env.LEDGER_API_URL;
const LEDGER_API_TOKEN_URL = process.env.LEDGER_API_TOKEN_URL;
const LEDGER_API_CLIENT_ID = process.env.LEDGER_API_CLIENT_ID;
const LEDGER_API_CLIENT_SECRET = process.env.LEDGER_API_CLIENT_SECRET;
const LEDGER_API_SCOPE = process.env.LEDGER_API_SCOPE || "daml_ledger_api";

export const DEVNET_MODE = process.env.LEDGER_TARGET === "devnet" && Boolean(LEDGER_API_URL);

// Same curl-over-fetch reasoning as the JSON API proxy -- shells out
// rather than using Node's fetch/http client, which reliably failed
// against Canton's pekko-http server in the old dashboard's serve.py.
export function runCurl(args, stdinData) {
  return new Promise((resolve, reject) => {
    const curl = spawn("curl", args);
    const stdout = [];
    const stderr = [];
    curl.stdout.on("data", (d) => stdout.push(d));
    curl.stderr.on("data", (d) => stderr.push(d));
    curl.on("error", reject);
    curl.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    if (stdinData !== undefined) curl.stdin.write(stdinData);
    curl.stdin.end();
  });
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export async function getDevnetToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: LEDGER_API_CLIENT_ID,
    client_secret: LEDGER_API_CLIENT_SECRET,
    scope: LEDGER_API_SCOPE,
  }).toString();

  const text = await runCurl(
    ["-s", "-S", "-X", "POST", LEDGER_API_TOKEN_URL,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "--data-binary", "@-"],
    body,
  );

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`token endpoint didn't return JSON: ${text.slice(0, 300)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`token endpoint response had no access_token: ${text.slice(0, 300)}`);
  }

  cachedToken = parsed.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max((parsed.expires_in || 300) - 60, 30) * 1000;
  return cachedToken;
}

// The token's own `sub` claim is the Ledger API userId this identity is
// authenticated as (confirmed against a live token: sub "10", matching
// what Five North's Canton admin referred to as "user 10" when granting
// CanReadAsAnyParty). Rights granted via /v2/users/{userId}/rights are
// per-userId, so anything that needs to grant itself a right decodes
// this rather than hardcoding a userId.
export function decodeUserId(token) {
  const payloadSegment = token.split(".")[1];
  const claims = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  return claims.sub;
}
