// Diagnostic route -- the DFNS Dashboard's Wallets page appeared to show
// zero wallets while a create-wallet call reported "Network wallet limit
// reached (2) for CantonTestnet", which don't add up if the dashboard
// shows every wallet regardless of status. This hits listWallets directly
// (paginating through everything, no status/network filter) so the raw
// data -- including Archived/deleted wallets the dashboard UI might be
// hiding -- can be read off instead of guessed at.
import { getDfnsClient } from "../../../lib/dfnsServer";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const items = [];
    let paginationToken;
    do {
      const page = await getDfnsClient().wallets.listWallets({
        query: { limit: 100, paginationToken },
      });
      items.push(...(page.items || []));
      paginationToken = page.nextPageToken;
    } while (paginationToken);

    res.status(200).json({
      count: items.length,
      wallets: items.map((w) => ({
        id: w.id,
        name: w.name,
        network: w.network,
        status: w.status,
        externalId: w.externalId,
        address: w.address,
        validatorId: w.validatorId,
        dateCreated: w.dateCreated,
        dateDeleted: w.dateDeleted,
      })),
    });
  } catch (err) {
    const message = err?.message || String(err);
    res.status(502).json({ cause: `DFNS wallet list failed: ${message}` });
  }
}
