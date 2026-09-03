// Diagnostic route -- see lib/dfnsServer.js's listCantonValidators comment.
// The DFNS Dashboard's Canton Validators page shows a name but not the
// cv-xxxxx-xxxxx-... id that DFNS_CANTON_VALIDATOR_ID needs, so this
// exists purely to read that id off using the credentials already
// configured server-side (same as every other route in this folder).
// GET, no body -- this is a read, same reasoning as get-wallet.js.
import { listCantonValidators } from "../../../lib/dfnsServer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const validators = await listCantonValidators();
    res.status(200).json({ validators });
  } catch (err) {
    const message = err?.message || String(err);
    res.status(502).json({ cause: `DFNS validator lookup failed: ${message}` });
  }
}
