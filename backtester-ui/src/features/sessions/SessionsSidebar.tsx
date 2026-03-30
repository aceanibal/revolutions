import type { PaginationMeta, SavedSession, SessionType } from "../../types";
import { formatDuration } from "../../lib/backtestMath";

interface SessionsSidebarProps {
  sessions: SavedSession[];
  selectedSessionId: string;
  sessionTypeFilter: "all" | SessionType;
  backtestDateFilter: string;
  backtestPagination: PaginationMeta;
  onSessionTypeFilterChange: (value: "all" | SessionType) => void;
  onDateFilterChange: (value: string) => void;
  onRefresh: (page?: number, date?: string) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

export function SessionsSidebar({
  sessions,
  selectedSessionId,
  sessionTypeFilter,
  backtestDateFilter,
  backtestPagination,
  onSessionTypeFilterChange,
  onDateFilterChange,
  onRefresh,
  onSelectSession
}: SessionsSidebarProps) {
  const groupedImportedSessions = sessions.reduce<Map<string, SavedSession[]>>((groups, session) => {
    const day = new Date(session.startedAtMs).toLocaleDateString();
    const list = groups.get(day) || [];
    list.push(session);
    groups.set(day, list);
    return groups;
  }, new Map<string, SavedSession[]>());

  return (
    <>
      <div className="panel-header">
        <h2>Backtest Sessions</h2>
        <span>
          page {backtestPagination.page}/{backtestPagination.totalPages} · total {backtestPagination.total}
        </span>
      </div>
      <div className="filter-row">
        <select
          value={sessionTypeFilter}
          onChange={(e) => onSessionTypeFilterChange((e.target.value as "all" | SessionType) || "all")}
        >
          <option value="all">All types</option>
          <option value="live">Live</option>
          <option value="historical">Historical</option>
        </select>
        <input type="date" value={backtestDateFilter} onChange={(e) => onDateFilterChange(e.target.value)} />
        <button type="button" onClick={() => void onRefresh(1, backtestDateFilter)}>
          Filter
        </button>
        <button type="button" onClick={() => void onRefresh(1, "")}>
          Clear
        </button>
      </div>
      <div className="session-list">
        {Array.from(groupedImportedSessions.entries()).map(([day, items]) => (
          <div key={day}>
            <div className="group-title">{day}</div>
            {items.map((session) => (
              <button
                key={session.id}
                className={selectedSessionId === session.id ? "session-item selected" : "session-item"}
                onClick={() => onSelectSession(session.id)}
                type="button"
              >
                <div className="row">
                  <strong>{new Date(session.startedAtMs).toLocaleTimeString()}</strong>
                  <span>
                    {session.sessionType === "historical" ? "[H] " : ""}
                    {formatDuration(session.startedAtMs, session.endedAtMs)}
                  </span>
                </div>
                <div className="sub">{session.id}</div>
                <div className="sub">
                  {session.assetCount} assets · {session.candleCount} candles
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="pager">
        <button
          type="button"
          disabled={backtestPagination.page <= 1}
          onClick={() => void onRefresh(backtestPagination.page - 1, backtestDateFilter)}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={backtestPagination.page >= backtestPagination.totalPages}
          onClick={() => void onRefresh(backtestPagination.page + 1, backtestDateFilter)}
        >
          Next
        </button>
      </div>
    </>
  );
}
