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
  offset?: number;
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
  const t0 = performance.now();

  if (!LOG_FILE_PATH) {
    throw new Error('LOG_FILE_PATH not configured');
  }

  const file = Bun.file(LOG_FILE_PATH);
  const t1 = performance.now();

  if (!(await file.exists())) {
    throw new Error(`Log file not found: ${LOG_FILE_PATH}`);
  }
  const t2 = performance.now();

  // Default to today if no date range specified
  const effectiveFilter: LogFilter = {
    ...filter,
    from: filter.from ?? getTodayStart(),
    to: filter.to ?? getTodayEnd(),
  };

  const limit = effectiveFilter.limit || 1000;
  let count = 0;
  let buffer = '';
  let totalLines = 0;
  let skippedByFilter = 0;
  let chunkCount = 0;
  let totalBytes = 0;

  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const t3 = performance.now();

  console.log(`[streamLogs] init: file=${(t1-t0).toFixed(1)}ms, exists=${(t2-t1).toFixed(1)}ms, stream=${(t3-t2).toFixed(1)}ms`);
  console.log(`[streamLogs] filter: from=${effectiveFilter.from?.toISOString()}, to=${effectiveFilter.to?.toISOString()}`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount++;
      totalBytes += value?.length || 0;

      if (chunkCount === 1) {
        console.log(`[streamLogs] first chunk: ${(performance.now() - t3).toFixed(1)}ms, ${value?.length} bytes`);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        totalLines++;
        if (count >= limit) break;
        const entry = parseLogLine(line);
        if (entry && filterLog(entry, effectiveFilter)) {
          if (count === 0) {
            console.log(`[streamLogs] first match: ${(performance.now() - t3).toFixed(1)}ms, after ${totalLines} lines, ${skippedByFilter} skipped`);
          }
          onEntry(entry);
          count++;
        } else {
          skippedByFilter++;
        }
      }

      if (count >= limit) break;
    }

    // Process remaining buffer
    if (count < limit && buffer.trim()) {
      totalLines++;
      const entry = parseLogLine(buffer);
      if (entry && filterLog(entry, effectiveFilter)) {
        onEntry(entry);
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log(`[streamLogs] done: ${(performance.now() - t0).toFixed(1)}ms, ${chunkCount} chunks, ${(totalBytes/1024/1024).toFixed(1)}MB, ${totalLines} lines, ${skippedByFilter} skipped`);
}

export async function readLogs(filter: LogFilter = {}): Promise<{ logs: LogEntry[]; hasMore: boolean; total: number }> {
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
  const offset = effectiveFilter.offset || 0;
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

  const total = matchedEntries.length;
  const logs = matchedEntries.slice(offset, offset + limit);

  return {
    logs,
    hasMore: offset + limit < total,
    total,
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
