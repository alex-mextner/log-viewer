import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  hasData: boolean; // true as soon as first log arrives (for opacity)
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

export function useLogs({ password, filter, initialLogs }: UseLogsOptions): UseLogsResult {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [hasData, setHasData] = useState(Boolean(initialLogs?.length));
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasInitialLogs = useRef(initialLogs && initialLogs.length > 0);
  const skipNextEffect = useRef(hasInitialLogs.current);

  // Stable filter key for effect dependency
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        from: filter.from,
        to: filter.to,
        level: filter.level,
        limit: filter.limit,
        page: filter.page,
      }),
    [filter.from, filter.to, filter.level, filter.limit, filter.page]
  );

  // Connect to SSE stream - it sends historical logs first, then real-time updates
  useEffect(() => {
    if (!password) return;

    // Skip first effect if we have SSR logs (avoid double load)
    if (skipNextEffect.current) {
      skipNextEffect.current = false;
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setLoading(true);
    setError(null);
    setLogs([]);
    setHasData(false);

    // Capture limit for closure (filter.limit may change)
    const hasLimit = filter.limit !== undefined;

    const url = buildUrl('/api/logs/stream', password, filter);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;
    let historicalDone = false;
    let intentionallyClosed = false;
    let firstLogReceived = false;

    eventSource.onopen = () => {
      setStreaming(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (!firstLogReceived) {
          firstLogReceived = true;
          setHasData(true);
        }
        setLogs((prev) => [...prev, entry]);
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.addEventListener('historical-end', () => {
      historicalDone = true;
      setLoading(false);
      // If we have a limit, server will close connection - that's expected
      if (hasLimit) {
        intentionallyClosed = true;
      }
    });

    eventSource.onerror = () => {
      setStreaming(false);
      // Only show error if it's unexpected (not server-initiated close after pagination)
      if (!historicalDone && !intentionallyClosed) {
        setLoading(false);
        setError('Connection lost');
      }
      eventSource.close();
      eventSourceRef.current = null;
    };

    return () => {
      intentionallyClosed = true;
      eventSource.close();
      eventSourceRef.current = null;
      setStreaming(false);
    };
  }, [password, filterKey]);

  const refresh = useCallback(() => {
    skipNextEffect.current = false; // Allow effect to run
    // Close existing and let effect handle reconnection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setLoading(true);
    setError(null);
    setLogs([]);
    setHasData(false);

    const url = buildUrl('/api/logs/stream', password, filter);
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;
    let historicalDone = false;
    let intentionallyClosed = false;
    let firstLogReceived = false;

    eventSource.onopen = () => setStreaming(true);
    eventSource.onmessage = (event) => {
      try {
        if (!firstLogReceived) {
          firstLogReceived = true;
          setHasData(true);
        }
        setLogs((prev) => [...prev, JSON.parse(event.data)]);
      } catch {}
    };
    eventSource.addEventListener('historical-end', () => {
      historicalDone = true;
      setLoading(false);
      if (filter.limit !== undefined) {
        intentionallyClosed = true;
      }
    });
    eventSource.onerror = () => {
      setStreaming(false);
      if (!historicalDone && !intentionallyClosed) {
        setLoading(false);
        setError('Connection lost');
      }
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [password, filter]);

  return { logs, loading, error, refresh, streaming, hasData };
}
