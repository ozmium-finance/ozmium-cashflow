import { spawn } from "child_process";

// Streams the raw request body straight through to curl instead of
// letting Next.js parse/re-serialize it -- same reason serve.py forwarded
// bytes as-is rather than round-tripping through a JSON parser.
export const config = {
  api: { bodyParser: false },
};

const JSON_API_HOST = process.env.JSON_API_HOST || "localhost";
const JSON_API_PORT = process.env.JSON_API_PORT || "7575";

// Real Canton network (e.g. ozmium-devnet-1) instead of the local dpm
// sandbox. Requires LEDGER_TARGET=devnet as an explicit opt-in, on top of
// the other four -- just having credentials sitting in .env.local should
// never silently redirect the existing sandbox scenarios away from the
// local sandbox they were built and tested against. See
// .env.local.example.
const LEDGER_API_URL = process.env.LEDGER_API_URL;
const LEDGER_API_TOKEN_URL = process.env.LEDGER_API_TOKEN_URL;
const LEDGER_API_CLIENT_ID = process.env.LEDGER_API_CLIENT_ID;
const LEDGER_API_CLIENT_SECRET = process.env.LEDGER_API_CLIENT_SECRET;
// Authentik only applies a scope's claim mapping if the client actually
// asks for it -- being *available* on the provider isn't enough. This is
// the custom scope (an Authentik "Property Mapping") that carries the
// Canton-specific rights claims; without asking for it explicitly we got
// an authenticated-but-rightsless token (403 PERMISSION_DENIED, not 401).
const LEDGER_API_SCOPE = process.env.LEDGER_API_SCOPE || "daml_ledger_api";
const DEVNET_MODE = process.env.LEDGER_TARGET === "devnet" && Boolean(LEDGER_API_URL);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Same curl-over-fetch reasoning as the main proxy below -- shells out
// rather than using Node's fetch, and resolves with raw stdout text
// (caller parses it) or rejects on a curl-level failure.
function runCurl(args, stdinData) {
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

// Client-credentials access token, cached in memory for this Next.js
// server process. Fine for a single-operator demo dashboard -- there's
// one shared m2m identity, not per-user tokens. Refetched a bit before
// actual expiry so a slow request doesn't race a token that just went
// stale mid-flight.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getDevnetToken() {
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

  // Debug only: log the token's own claims (not the signature) to the
  // server terminal so we can see what rights/parties this identity
  // actually carries -- the 403s we're chasing say "authenticated fine,
  // not authorized for this," and the fastest way to tell a missing-scope
  // problem from a this-identity-was-never-meant-to-have-that problem is
  // to just read what Canton itself was told. Nothing here leaves this
  // process; it never reaches the browser.
  try {
    const payloadSegment = parsed.access_token.split(".")[1];
    const claims = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    console.log("[devnet token claims]", JSON.stringify(claims, null, 2));
  } catch (err) {
    console.log("[devnet token claims] couldn't decode:", err.message);
  }

  cachedToken = parsed.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max((parsed.expires_in || 300) - 60, 30) * 1000;
  return cachedToken;
}

// Same workaround the old dashboard's serve.py needed: Python's
// http.client/urllib reliably got a "remote end closed connection"
// against Canton's pekko-http JSON API server on every request, while
// curl against the identical URL never failed once. Never got a root
// cause for *why* -- just a decisive fix. Shelling out to curl here too,
// since there's no reason to assume Node's own fetch/http client would
// fare any better against the same server and this is the one piece of
// this proxy that's actually been proven against a live sandbox before.
export default async function handler(req, res) {
  const pathParts = req.query.path;
  const path = Array.isArray(pathParts) ? pathParts.join("/") : "";
  const target = DEVNET_MODE
    ? `${LEDGER_API_URL.replace(/\/+$/, "")}/v2/${path}`
    : `http://${JSON_API_HOST}:${JSON_API_PORT}/v2/${path}`;

  const body = req.method === "POST" ? await readRawBody(req) : Buffer.alloc(0);

  const args = ["-s", "-S", "-X", req.method, target, "-w", "\n%{http_code}"];
  if (DEVNET_MODE) {
    let token;
    try {
      token = await getDevnetToken();
    } catch (err) {
      res.status(502).json({ error: `Couldn't get a devnet access token: ${err.message}` });
      return;
    }
    args.push("-H", `Authorization: Bearer ${token}`);
  } else if (req.headers["authorization"]) {
    args.push("-H", `Authorization: ${req.headers["authorization"]}`);
  }
  if (body.length > 0) {
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  }

  const curl = spawn("curl", args);
  const stdout = [];
  const stderr = [];
  curl.stdout.on("data", (d) => stdout.push(d));
  curl.stderr.on("data", (d) => stderr.push(d));

  curl.on("error", (err) => {
    // Most likely means curl isn't on PATH. Windows 10 (1803+) and 11
    // ship curl.exe by default, so this shouldn't normally fire -- but
    // fail loudly instead of hanging if it does.
    res.status(502).json({ error: `Couldn't run curl: ${err.message}` });
  });

  curl.on("close", (code) => {
    if (res.writableEnded) return;
    if (code !== 0) {
      res.status(502).json({ error: `curl exited ${code}: ${Buffer.concat(stderr).toString("utf8")}` });
      return;
    }
    const text = Buffer.concat(stdout).toString("utf8");
    const splitAt = text.lastIndexOf("\n");
    const respBody = text.slice(0, splitAt);
    const statusCode = parseInt(text.slice(splitAt + 1).trim(), 10) || 502;
    res.status(statusCode);
    res.setHeader("Content-Type", "application/json");
    res.send(respBody);
  });

  if (body.length > 0) {
    curl.stdin.write(body);
  }
  curl.stdin.end();
}
