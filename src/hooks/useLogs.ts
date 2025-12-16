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
  limit?: number;
  page?: number;
}

interface UseLogsOptions {
  password: string;
  filter: LogFilter;
  autoRefresh?: boolean;
  initialLogs?: LogEntry[];
}

interface UseLogsResult {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  streaming: boolean;
}

function buildUrl(endpoint: string, password: string, filter: LogFilter): string {
  const params = new URLSearchParams();
  params.set('pwd', password);

  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (filter.level?.length) params.set('level', filter.level.join(','));
  if (filter.limit !== undefined) {
    params.set('limit', String(filter.limit));
    // Calculate offset from page
    const page = filter.page || 1;
    if (page > 1) {
      params.set('offset', String((page - 1) * filter.limit));
    }
  }

  return `${endpoint}?${params.toString()}`;
}

export function useLogs({ password, filter, autoRefresh = true, initialLogs }: UseLogsOptions): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasInitialLogs = useRef((initialLogs?.length || 0) > 0);

  // Connect to SSE stream - it sends historical logs first, then real-time updates
  const connectStream = useCallback(() => {
    if (!password) return;

    // Skip if we have SSR logs on first load
    if (hasInitialLogs.current) {
      hasInitialLogs.current = false;
      // Still connect for real-time updates but don't show loading
      if (!autoRefresh) return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLoading(true);
    setError(null);
    setLogs([]); // Clear logs, they'll stream in

    const url = buildUrl('/api/logs/stream', password, filter);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setStreaming(true);
    };

    // Regular log entries
    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => [...prev, entry]);
      } catch {
        // Ignore parse errors
      }
    };

    // Historical logs finished loading
    eventSource.addEventListener('historical-end', () => {
      setLoading(false);
    });

    eventSource.onerror = (e) => {
      setStreaming(false);
      setLoading(false);
      // Don't show error if connection was closed normally (e.g., pagination mode)
      if (eventSource.readyState !== EventSource.CLOSED) {
        setError('Connection lost');
      }
      eventSource.close();
    };
  }, [password, filter, autoRefresh]);

  // Connect on mount and when filter changes
  useEffect(() => {
    connectStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        setStreaming(false);
      }
    };
  }, [connectStream]);

  return {
    logs,
    loading,
    error,
    refresh: connectStream,
    streaming,
  };
}
