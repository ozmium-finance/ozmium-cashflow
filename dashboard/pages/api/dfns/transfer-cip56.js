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
    // SettlementInstruction (e.g. "50000.0000000000"). Whether this needs
    // scaling to a minimum-denomination integer at all is genuinely
    // unconfirmed for Canton's Cip56 kind specifically -- DFNS's "amount
    // in minimum denomination" wording on transferAsset is shared
    // boilerplate across every chain kind in that union type (EVM, UTXO,
    // ...), and OZM's own DA Registry Instrument Configuration has no
    // decimals field at all to convert against -- Canton just uses
    // Daml's native Decimal directly, unlike an EVM token's wei-style
    // integer amounts. So: DFNS_OZM_DECIMALS=raw sends the literal
    // decimal string through unscaled (the more likely-correct default
    // for Cip56 given the above); set it to an actual integer only if
    // testing shows DFNS truly wants a scaled minimum-denomination value
    // for this instrument.
    const decimalsRaw = process.env.DFNS_OZM_DECIMALS;
    if (decimalsRaw === undefined || decimalsRaw === "") {
      res.status(400).json({
        cause: 'DFNS_OZM_DECIMALS isn\'t configured -- set it to "raw" to send the literal decimal amount unscaled (Canton/CIP-56 has no confirmed minimum-denomination concept for OZM), or to an integer decimals count if testing shows DFNS expects one',
      });
      return;
    }
    const isRaw = decimalsRaw.trim().toLowerCase() === "raw";
    const transferAmount = isRaw ? String(amount) : toMinimumDenomination(amount, Number(decimalsRaw));

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
