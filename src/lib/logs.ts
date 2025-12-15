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

export async function readLogs(filter: LogFilter = {}): Promise<{ logs: LogEntry[]; hasMore: boolean }> {
  if (!LOG_FILE_PATH) {
    throw new Error('LOG_FILE_PATH not configured');
  }

  const file = Bun.file(LOG_FILE_PATH);

  if (!(await file.exists())) {
    throw new Error(`Log file not found: ${LOG_FILE_PATH}`);
  }

  const limit = filter.limit || 1000;

  // Read only last 500KB to avoid memory issues with large files
  const stat = await file.stat();
  const fileSize = stat?.size || 0;
  const readSize = Math.min(fileSize, 500 * 1024); // 500KB max
  const startPos = Math.max(0, fileSize - readSize);

  const slice = file.slice(startPos, fileSize);
  const text = await slice.text();
  const lines = text.split('\n');

  // Skip first line if we started mid-file (it's likely incomplete)
  if (startPos > 0 && lines.length > 0) {
    lines.shift();
  }

  const logs: LogEntry[] = [];

  // Read from end for most recent logs
  for (let i = lines.length - 1; i >= 0 && logs.length < limit; i--) {
    const entry = parseLogLine(lines[i]);
    if (entry && filterLog(entry, filter)) {
      logs.unshift(entry); // Add to beginning to maintain order
    }
  }

  return {
    logs,
    hasMore: logs.length >= limit,
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
