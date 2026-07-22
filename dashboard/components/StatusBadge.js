export default function StatusBadge({ status, lastUpdate, okPrefix = "connected" }) {
  let text = "idle";
  if (status === "ok") {
    text = lastUpdate ? `${okPrefix} — last update ${new Date(lastUpdate).toLocaleTimeString()}` : okPrefix;
  } else if (status === "err") {
    text = "error";
  }
  return <span className={`status ${status}`}>{text}</span>;
}
