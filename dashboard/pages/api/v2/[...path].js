import { LEDGER_API_URL, DEVNET_MODE, runCurl, getDevnetToken, decodeUserId } from "../../../lib/devnetServer";

// Streams the raw request body straight through to curl instead of
// letting Next.js parse/re-serialize it -- same reason serve.py forwarded
// bytes as-is rather than round-tripping through a JSON parser.
export const config = {
  api: { bodyParser: false },
};

const JSON_API_HOST = process.env.JSON_API_HOST || "localhost";
const JSON_API_PORT = process.env.JSON_API_PORT || "7575";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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
  // Next.js splits a catch-all route's query string into `path` (the
  // segment array) plus every other param as its own req.query key --
  // it does NOT put the raw query string anywhere. Missing this meant
  // ?pageSize=...&pageToken=... from lib/api.js's pagination was
  // silently dropped on every request, so the "paginated" party lookup
  // was actually re-fetching the exact same first page 20 times in a
  // row against devnet -- looked like the UI was just stuck, when it
  // was really just doing 20x more round trips than it needed to for no
  // benefit at all.
  const { path: pathParts, ...restQuery } = req.query;
  const path = Array.isArray(pathParts) ? pathParts.join("/") : "";
  const qs = new URLSearchParams(restQuery).toString();
  const suffix = qs ? `?${qs}` : "";
  const target = DEVNET_MODE
    ? `${LEDGER_API_URL.replace(/\/+$/, "")}/v2/${path}${suffix}`
    : `http://${JSON_API_HOST}:${JSON_API_PORT}/v2/${path}${suffix}`;

  let body = req.method === "POST" ? await readRawBody(req) : Buffer.alloc(0);

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

    // lib/api.js's submitCommand sends a fixed userId ("ozmium-dashboard")
    // on every command -- fine against the local dpm sandbox, which has
    // no auth service to check it against, but devnet does. That string
    // was never registered as a Ledger API User there, while the token
    // itself authenticates as a real one (userId "10", confirmed via its
    // own `sub` claim). Overwriting it here means every submit-and-wait
    // call is made under the identity the token actually is, without
    // having to plumb "what's our real userId" out to every browser-side
    // call site individually.
    if (path.startsWith("commands/") && body.length > 0) {
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        if (typeof parsed === "object" && parsed !== null && "userId" in parsed) {
          parsed.userId = decodeUserId(token);
          body = Buffer.from(JSON.stringify(parsed), "utf8");
        }
      } catch {
        // Not JSON, or no userId field -- leave the body untouched and
        // let Canton's own error response explain what's wrong with it.
      }
    }
  } else if (req.headers["authorization"]) {
    args.push("-H", `Authorization: ${req.headers["authorization"]}`);
  }
  if (body.length > 0) {
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  }

  let text;
  try {
    text = await runCurl(args, body.length > 0 ? body : undefined);
  } catch (err) {
    // Most likely means curl isn't on PATH. Windows 10 (1803+) and 11
    // ship curl.exe by default, so this shouldn't normally fire -- but
    // fail loudly instead of hanging if it does.
    res.status(502).json({ error: `Couldn't run curl: ${err.message}` });
    return;
  }

  const splitAt = text.lastIndexOf("\n");
  const respBody = text.slice(0, splitAt);
  const statusCode = parseInt(text.slice(splitAt + 1).trim(), 10) || 502;
  res.status(statusCode);
  res.setHeader("Content-Type", "application/json");
  res.send(respBody);
}
