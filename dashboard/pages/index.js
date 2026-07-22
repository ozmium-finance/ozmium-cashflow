import Head from "next/head";
import { useSelector } from "react-redux";
import DemoPanel from "../components/DemoPanel";
import Board from "../components/Board";
import StatusBadge from "../components/StatusBadge";

export default function OperatorPage() {
  const board = useSelector((s) => s.board);

  return (
    <>
      <Head><title>Ozmium — Operator Pipeline View</title></Head>
      <header>
        <div>
          <h1>Ozmium — Operator Pipeline View</h1>
          <div className="sub">Live from the Canton JSON Ledger API v2</div>
        </div>
        <div className="controls">
          <StatusBadge status={board.status} lastUpdate={board.lastUpdate} />
        </div>
      </header>

      <DemoPanel />

      {board.status === "err" && (
        <div id="errorBanner">
          {`Couldn't reach the JSON API or parse its response:\n${board.error}\n\nCheck: is dpm sandbox --json-api-port <port> running, and does the terminal running "npm run dev" show a proxy error?`}
        </div>
      )}

      <Board />
    </>
  );
}
