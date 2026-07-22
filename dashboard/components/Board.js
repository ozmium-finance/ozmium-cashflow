import { useSelector } from "react-redux";
import { STAGES } from "../lib/stages";
import Card from "./Card";

export default function Board() {
  const contractsByStage = useSelector((s) => s.board.contractsByStage);
  return (
    <div className="board">
      {STAGES.map((stage) => {
        const items = contractsByStage[stage.key] || [];
        return (
          <div className="column" key={stage.key}>
            <div className="column-header">
              <div className="step">Step</div>
              <div className="name">{stage.label}<span className="count">{items.length}</span></div>
            </div>
            <div className="cards">
              {items.length === 0 ? (
                <div className="empty">Nothing here yet</div>
              ) : (
                items.map((ev) => <Card key={ev.contractId} stageKey={stage.key} ev={ev} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
