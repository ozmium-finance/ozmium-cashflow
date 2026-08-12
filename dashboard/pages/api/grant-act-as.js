import { LEDGER_API_URL, DEVNET_MODE, runCurl, getDevnetToken, decodeUserId } from "../../lib/devnetServer";

// Canton has no wildcard CanActAs (unlike CanReadAsAnyParty) -- per
// Five North: "CanActAs is granted per party, so after allocating a new
// party, user 10 needs to be granted CanActAs for that specific party
// before it can submit commands as it... user 10 has ParticipantAdmin,
// [so it] should be able to grant itself the required CanActAs right
// through the Ledger API User Management service after allocating the
// party." This route is that self-grant step: lib/api.js's
// getOrAllocateParty calls it right after a party is created/found,
// before anything ever tries to submitCommand as that party.
//
// Local dpm sandbox mode has no auth service at all -- there's no user
// to grant rights to and nothing enforcing them -- so this is a no-op
// outside DEVNET_MODE.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!DEVNET_MODE) {
    res.status(200).json({ skipped: "not in devnet mode" });
    return;
  }

  const { party } = req.body || {};
  if (!party) {
    res.status(400).json({ error: "Missing party" });
    return;
  }

  let token;
  try {
    token = await getDevnetToken();
  } catch (err) {
    res.status(502).json({ error: `Couldn't get a devnet access token: ${err.message}` });
    return;
  }

  let userId;
  try {
    userId = decodeUserId(token);
  } catch (err) {
    res.status(502).json({ error: `Couldn't decode userId from devnet token: ${err.message}` });
    return;
  }

  const body = JSON.stringify({
    identityProviderId: "",
    userId,
    rights: [{ kind: { CanActAs: { value: { party } } } }],
  });

  const base = LEDGER_API_URL.replace(/\/+$/, "");
  let text;
  try {
    text = await runCurl(
      ["-s", "-S", "-X", "POST", `${base}/v2/users/${encodeURIComponent(userId)}/rights`,
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Content-Type: application/json",
        "-w", "\n%{http_code}",
        "--data-binary", "@-"],
      body,
    );
  } catch (err) {
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
