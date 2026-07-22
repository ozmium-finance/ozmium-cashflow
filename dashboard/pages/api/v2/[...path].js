import { spawn } from "child_process";

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
  const pathParts = req.query.path;
  const path = Array.isArray(pathParts) ? pathParts.join("/") : "";
  const target = `http://${JSON_API_HOST}:${JSON_API_PORT}/v2/${path}`;

  const body = req.method === "POST" ? await readRawBody(req) : Buffer.alloc(0);

  const args = ["-s", "-S", "-X", req.method, target, "-w", "\n%{http_code}"];
  if (req.headers["authorization"]) {
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
