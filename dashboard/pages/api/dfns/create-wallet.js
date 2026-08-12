// Thin route around lib/dfnsServer.js -- keeps the DFNS service account's
// private key and auth token entirely server-side. The browser only ever
// sees { name, externalId } going out and { id, address, network, status }
// coming back, never the credentials that made the call possible.
import { createCantonTestnetWallet } from "../../../lib/dfnsServer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { name, externalId } = req.body || {};
    const wallet = await createCantonTestnetWallet({ name, externalId });
    res.status(200).json(wallet);
  } catch (err) {
    // DFNS error bodies are usually JSON with a `message` -- surface it
    // the same way api.js does for Canton's `cause` field, so the demo
    // log shows the real reason instead of a bare "request failed".
    // `cause` (not `error`) on purpose -- apiFetch in lib/api.js already
    // knows how to pull a `cause` field out of a non-2xx JSON body and
    // fold it into the thrown error's first line, same as it does for
    // Canton's JSON API responses.
    const message = err?.message || String(err);
    res.status(502).json({ cause: `DFNS wallet creation failed: ${message}` });
  }
}
