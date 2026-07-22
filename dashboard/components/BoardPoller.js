import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { fetchActiveContracts, matchStage } from "../lib/api";
import { STAGES } from "../lib/stages";
import { setBoardOk, setBoardError } from "../store/boardSlice";

const REFRESH_INTERVAL_MS = 3000;

// Mounted once in _app.js, outside any page -- so it keeps polling
// regardless of which of the three pages you're on, instead of each
// page starting/stopping its own timer. That's also what makes the
// Operator board's live state survive clicking to Investor/Audit and
// back: this component (and the Redux store it writes to) never
// unmounts during client-side navigation, only on a real page reload.
export default function BoardPoller() {
  const dispatch = useDispatch();
  const lastSignature = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const events = await fetchActiveContracts();
        const byStage = {};
        for (const stage of STAGES) {
          byStage[stage.key] = events.filter((ev) => matchStage(ev.templateId, stage.template));
        }
        // Skip the dispatch (and therefore the re-render) when nothing
        // actually changed, so cards don't replay their entrance
        // animation every 3s for no reason -- same fix the old
        // dashboard needed for the same blinking complaint.
        const signature = JSON.stringify(byStage, (key, value) => (key === "createdAt" || key === "offset" ? undefined : value));
        if (cancelled || signature === lastSignature.current) return;
        lastSignature.current = signature;
        dispatch(setBoardOk(byStage));
      } catch (err) {
        if (!cancelled) dispatch(setBoardError(err.message));
      }
    }

    tick();
    const timer = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dispatch]);

  return null;
}
