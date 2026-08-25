// Thin route around lib/dfnsServer.js's getCantonTestnetWallet --
// resolves a DFNS walletId (the only thing AddressBookEntry stores on
// the Canton side) to its current on-chain address, which is what
// transfer-cip56's `to` field actually needs. GET with a query param,
// not POST -- this is a read, same as create-wallet.js being POST makes
// sense because that one mutates (creates a wallet).
import { getCantonTestnetWallet } from "../../../lib/dfnsServer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { walletId } = req.query || {};
    if (!walletId) {
      res.status(400).json({ cause: "Missing walletId query param" });
      return;
    }
    const wallet = await getCantonTestnetWallet(walletId);
    res.status(200).json(wallet);
  } catch (err) {
    const message = err?.message || String(err);
    res.status(502).json({ cause: `DFNS wallet lookup failed: ${message}` });
  }
}
