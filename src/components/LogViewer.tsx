import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '@/hooks/useLogs';

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

interface LogViewerProps {
  logs: LogEntry[];
  loading: boolean;
  streaming: boolean;
  showAutoScroll?: boolean;
}

function formatTime(time: string): string {
  try {
    const date = new Date(time);
    return date.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return time;
  }
}

function LogRow({ entry, onClick }: { entry: LogEntry; onClick: () => void }) {
  const levelColor = LEVEL_COLORS[entry.level] || 'text-gray-400';

  return (
    <div
      className="flex gap-2 px-2 py-0.5 hover:bg-accent cursor-pointer text-sm font-mono"
      onClick={onClick}
    >
      <span className="text-muted-foreground shrink-0">{formatTime(entry.time)}</span>
      <span className={`shrink-0 w-12 uppercase ${levelColor}`}>{entry.level}</span>
      <span className="text-muted-foreground shrink-0 w-24 truncate">{entry.module || '-'}</span>
      <span className="truncate">{entry.msg}</span>
    </div>
  );
}

function LogDetail({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Log Entry</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <pre className="p-4 text-sm font-mono overflow-x-auto">{JSON.stringify(entry, null, 2)}</pre>
      </div>
    </div>
  );
}

export function LogViewer({ logs, loading, streaming, showAutoScroll = false }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);

  // Auto-scroll when new logs arrive (only when showAutoScroll is enabled)
  useEffect(() => {
    if (showAutoScroll && autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, showAutoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading logs...
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-auto bg-background border rounded transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}
      >
        {logs.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">No logs found</div>
        ) : (
          logs.map((entry, i) => (
            <LogRow key={`${entry.time}-${i}`} entry={entry} onClick={() => setSelectedEntry(entry)} />
          ))
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1">
        <span>{logs.length} entries</span>
        <div className="flex items-center gap-2">
          {streaming && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
          {showAutoScroll && autoScroll && <span>Auto-scroll ON</span>}
        </div>
      </div>

      {/* Detail modal */}
      {selectedEntry && <LogDetail entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </>
  );
}
