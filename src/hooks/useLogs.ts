import { useCallback, useEffect, useRef, useState } from 'react';

export interface LogEntry {
  level: string;
  time: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

export interface LogFilter {
  from?: string;
  to?: string;
  level?: string[];
}

interface UseLogsOptions {
  password: string;
  filter: LogFilter;
  autoRefresh?: boolean;
}

interface UseLogsResult {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  streaming: boolean;
}

// Get initial logs injected by server SSR
function getInitialLogs(): LogEntry[] {
  if (typeof window !== 'undefined' && Array.isArray((window as { __INITIAL_LOGS__?: LogEntry[] }).__INITIAL_LOGS__)) {
    const logs = (window as { __INITIAL_LOGS__?: LogEntry[] }).__INITIAL_LOGS__ || [];
    // Clear after reading to avoid stale data on subsequent renders
    delete (window as { __INITIAL_LOGS__?: LogEntry[] }).__INITIAL_LOGS__;
    return logs;
  }
  return [];
}

function buildUrl(endpoint: string, password: string, filter: LogFilter): string {
  const params = new URLSearchParams();
  params.set('pwd', password);

  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.level?.length) params.set('level', filter.level.join(','));

  return `${endpoint}?${params.toString()}`;
}

// Track if we've used initial logs
let initialLogsUsed = false;

export function useLogs({ password, filter, autoRefresh = true }: UseLogsOptions): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    // Use initial logs from SSR on first mount
    if (!initialLogsUsed) {
      const initial = getInitialLogs();
      if (initial.length > 0) {
        initialLogsUsed = true;
        return initial;
      }
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasInitialLogs = useRef(logs.length > 0);

  const fetchLogs = useCallback(async (skipIfHasLogs = false) => {
    if (!password) {
      setLoading(false);
      return;
    }

    // Skip fetch if we already have SSR logs (first load only)
    if (skipIfHasLogs && hasInitialLogs.current) {
      hasInitialLogs.current = false;
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = buildUrl('/api/logs', password, filter);
      const res = await fetch(url);

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Invalid password');
        }
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [password, filter]);

  // Initial fetch and on filter change
  useEffect(() => {
    fetchLogs(true); // Skip if has initial SSR logs
  }, [fetchLogs]);

  // SSE streaming
  useEffect(() => {
    if (!autoRefresh || !password) return;

    const url = buildUrl('/api/logs/stream', password, filter);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setStreaming(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => [...prev, entry]);
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setStreaming(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setStreaming(false);
    };
  }, [autoRefresh, password, filter]);

  return {
    logs,
    loading,
    error,
    refresh: () => fetchLogs(false),
    streaming,
  };
}
