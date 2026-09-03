// Thin route around lib/dfnsServer.js's transferCip56Asset -- same
// same-origin/credentials-stay-server-side reasoning as create-wallet.js.
// The browser sends { to, amount, externalId } and optionally overrides
// { walletId, instrumentId, instrumentAdmin }; when those three are
// omitted this falls back to the fund/treasury wallet and the OZM
// instrument's own identifiers, read server-side from process.env so
// the browser never has to know or be able to spoof which CIP-56
// instrument is moving.
import { transferCip56Asset, toMinimumDenomination } from "../../../lib/dfnsServer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const {
      walletId,
      instrumentAdmin,
      instrumentId,
      to,
      amount,
      externalId,
    } = req.body || {};

    const resolvedWalletId = walletId || process.env.DFNS_ISSUER_WALLET_ID || "";
    const resolvedInstrumentAdmin = instrumentAdmin || process.env.DFNS_OZM_INSTRUMENT_ADMIN || "";
    const resolvedInstrumentId = instrumentId || process.env.DFNS_OZM_INSTRUMENT_ID || "";

    if (!resolvedWalletId) {
      res.status(400).json({ cause: "No source wallet id -- pass walletId or set DFNS_ISSUER_WALLET_ID" });
      return;
    }
    if (!resolvedInstrumentAdmin || !resolvedInstrumentId) {
      res.status(400).json({
        cause: "OZM's CIP-56 instrumentId/instrumentAdmin aren't configured -- pass them explicitly or set DFNS_OZM_INSTRUMENT_ID / DFNS_OZM_INSTRUMENT_ADMIN (see wherever OZM was registered/minted)",
      });
      return;
    }
    if (!to) {
      res.status(400).json({ cause: "Missing destination address (to)" });
      return;
    }
    if (!amount) {
      res.status(400).json({ cause: "Missing amount" });
      return;
    }

    // `amount` arrives as a human-readable decimal string straight off
    // SettlementInstruction (e.g. "50000.0000000000"). This DOES need
    // scaling -- confirmed against DFNS's own published OpenAPI schema
    // for transferAsset's Cip56 variant, not a guess anymore: `amount`
    // is `type: string, pattern: ^\d+$`, digits only, no decimal point,
    // "in minimum denomination" -- same wei-style integer convention as
    // every other chain kind, not raw-Decimal-passthrough. A prior
    // version of this route had a "raw" mode that sent the unscaled
    // decimal string (e.g. "50000.0000000000") straight through; that
    // always fails DFNS's own schema validation (the literal "."
    // violates ^\d+$) and has been removed -- if you see "raw" in an
    // old .env, replace it with the real decimals count.
    const decimalsRaw = process.env.DFNS_OZM_DECIMALS;
    if (decimalsRaw === undefined || decimalsRaw === "" || Number.isNaN(Number(decimalsRaw))) {
      res.status(400).json({
        cause: "DFNS_OZM_DECIMALS isn't configured to a real integer -- set it to OZM's actual CIP-56 minimum-denomination decimals count (see wherever OZM was registered/minted; Daml's own Decimal is scale 10, which is a reasonable first guess but not confirmed for the instrument itself)",
      });
      return;
    }
    const transferAmount = toMinimumDenomination(amount, Number(decimalsRaw));

    const transfer = await transferCip56Asset({
      walletId: resolvedWalletId,
      instrumentAdmin: resolvedInstrumentAdmin,
      instrumentId: resolvedInstrumentId,
      to,
      amount: transferAmount,
      externalId,
    });
    res.status(200).json(transfer);
  } catch (err) {
    // Same `cause` convention as create-wallet.js -- apiFetch already
    // knows how to fold a `cause` field into the thrown error's first line.
    const message = err?.message || String(err);
    res.status(502).json({ cause: `DFNS CIP-56 transfer failed: ${message}` });
  }
}
