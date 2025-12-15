import { useState, useEffect, useCallback, useRef } from 'react';

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
  filter?: LogFilter;
  autoRefresh?: boolean;
}

interface UseLogsResult {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  streaming: boolean;
}

function buildUrl(endpoint: string, password: string, filter?: LogFilter): string {
  const params = new URLSearchParams();
  params.set('pwd', password);

  if (filter?.from) params.set('from', filter.from);
  if (filter?.to) params.set('to', filter.to);
  if (filter?.level?.length) params.set('level', filter.level.join(','));

  return `${endpoint}?${params.toString()}`;
}

export function useLogs({ password, filter, autoRefresh = true }: UseLogsOptions): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = buildUrl('/api/logs', password, filter);
      const res = await fetch(url);

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Invalid password');
        }
        throw new Error(await res.text());
      }

      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [password, filter]);

  // Initial fetch
  useEffect(() => {
    if (password) {
      fetchLogs();
    }
  }, [fetchLogs, password]);

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
    refresh: fetchLogs,
    streaming,
  };
}
