import { useEffect, useRef, useSyncExternalStore } from "react";
import { getLogs, subscribeLogs } from "../logs";

export function LogsPanel() {
  const logs = useSyncExternalStore(subscribeLogs, getLogs);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  return (
    <div className="logs">
      {logs.length === 0 ? (
        <div className="logs-empty">No logs yet.</div>
      ) : (
        logs.map((entry, i) => (
          <div key={i} className={`log-line ${entry.level}`}>
            <span className="log-time">{formatTime(entry.timestamp)}</span>
            <span className="log-level">{entry.level}</span>
            <span className="log-message">{entry.message}</span>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
