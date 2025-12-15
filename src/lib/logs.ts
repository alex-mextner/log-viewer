export interface LogEntry {
  level: string;
  time: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

export interface LogFilter {
  from?: Date;
  to?: Date;
  level?: string[];
  limit?: number;
}

const LOG_FILE_PATH = process.env.LOG_FILE_PATH || '';

export function getLogFilePath(): string {
  return LOG_FILE_PATH;
}

export function parseLogLine(line: string): LogEntry | null {
  if (!line.trim()) return null;

  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    // If not valid JSON, wrap as raw message
    return {
      level: 'info',
      time: new Date().toISOString(),
      msg: line,
    };
  }
}

export function filterLog(entry: LogEntry, filter: LogFilter): boolean {
  // Filter by level
  if (filter.level && filter.level.length > 0) {
    if (!filter.level.includes(entry.level)) {
      return false;
    }
  }

  // Filter by time range
  if (filter.from || filter.to) {
    const entryTime = new Date(entry.time);

    if (filter.from && entryTime < filter.from) {
      return false;
    }

    if (filter.to && entryTime > filter.to) {
      return false;
    }
  }

  return true;
}

function getTodayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function getTodayEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
}

export async function streamLogs(
  filter: LogFilter,
  onEntry: (entry: LogEntry) => void
): Promise<void> {
  if (!LOG_FILE_PATH) {
    throw new Error('LOG_FILE_PATH not configured');
  }

  const file = Bun.file(LOG_FILE_PATH);

  if (!(await file.exists())) {
    throw new Error(`Log file not found: ${LOG_FILE_PATH}`);
  }

  // Default to today if no date range specified
  const effectiveFilter: LogFilter = {
    ...filter,
    from: filter.from ?? getTodayStart(),
    to: filter.to ?? getTodayEnd(),
  };

  const limit = effectiveFilter.limit || 1000;
  let count = 0;
  let buffer = '';

  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (count >= limit) break;
        const entry = parseLogLine(line);
        if (entry && filterLog(entry, effectiveFilter)) {
          onEntry(entry);
          count++;
        }
      }

      if (count >= limit) break;
    }

    // Process remaining buffer
    if (count < limit && buffer.trim()) {
      const entry = parseLogLine(buffer);
      if (entry && filterLog(entry, effectiveFilter)) {
        onEntry(entry);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readLogs(filter: LogFilter = {}): Promise<{ logs: LogEntry[]; hasMore: boolean }> {
  if (!LOG_FILE_PATH) {
    throw new Error('LOG_FILE_PATH not configured');
  }

  const file = Bun.file(LOG_FILE_PATH);

  if (!(await file.exists())) {
    throw new Error(`Log file not found: ${LOG_FILE_PATH}`);
  }

  // Default to today if no date range specified
  const effectiveFilter: LogFilter = {
    ...filter,
    from: filter.from ?? getTodayStart(),
    to: filter.to ?? getTodayEnd(),
  };

  const limit = effectiveFilter.limit || 1000;
  const matchedEntries: LogEntry[] = [];
  let buffer = '';

  // Stream file in chunks - filter on the fly
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const entry = parseLogLine(line);
        if (entry && filterLog(entry, effectiveFilter)) {
          matchedEntries.push(entry);
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const entry = parseLogLine(buffer);
      if (entry && filterLog(entry, effectiveFilter)) {
        matchedEntries.push(entry);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Return last N entries (most recent)
  const startIdx = Math.max(0, matchedEntries.length - limit);
  const logs = matchedEntries.slice(startIdx);

  return {
    logs,
    hasMore: matchedEntries.length > limit,
  };
}

export function formatLogForText(entry: LogEntry): string {
  const time = entry.time.replace('T', ' ').replace('Z', '');
  const module = entry.module || '-';
  const extras = Object.entries(entry)
    .filter(([k]) => !['level', 'time', 'module', 'msg', 'pid', 'hostname'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');

  return `${time} [${entry.level}] ${module}: ${entry.msg}${extras ? ` (${extras})` : ''}`;
}

export function tailLogs(
  filter: LogFilter,
  onEntry: (entry: LogEntry) => void,
  onError: (error: Error) => void
): () => void {
  if (!LOG_FILE_PATH) {
    onError(new Error('LOG_FILE_PATH not configured'));
    return () => {};
  }

  let lastSize = 0;
  let buffer = '';
  let aborted = false;

  const init = async () => {
    const file = Bun.file(LOG_FILE_PATH);
    if (await file.exists()) {
      const stat = await file.stat();
      lastSize = stat?.size || 0;
    }
  };

  const readNewContent = async () => {
    if (aborted) return;

    try {
      const file = Bun.file(LOG_FILE_PATH);
      if (!(await file.exists())) return;

      const stat = await file.stat();
      const currentSize = stat?.size || 0;

      if (currentSize > lastSize) {
        const slice = file.slice(lastSize, currentSize);
        const newContent = await slice.text();

        buffer += newContent;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const entry = parseLogLine(line);
          if (entry && filterLog(entry, filter)) {
            onEntry(entry);
          }
        }

        lastSize = currentSize;
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Use fs.watch for file changes
  let watcher: ReturnType<typeof import('fs').watch> | null = null;

  const startWatching = async () => {
    await init();
    const fs = await import('node:fs');

    watcher = fs.watch(LOG_FILE_PATH, (eventType) => {
      if (eventType === 'change') {
        readNewContent();
      }
    });

    watcher.on('error', onError);
  };

  startWatching();

  // Return cleanup function
  return () => {
    aborted = true;
    watcher?.close();
  };
}
