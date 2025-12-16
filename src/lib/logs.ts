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

// Cache for file offset by date - speeds up repeated queries
interface OffsetCache {
  fromDate: string; // ISO date string (day precision)
  byteOffset: number;
  firstLine: string; // For validation
  fileSize: number; // Invalidate if file shrunk (rotation)
}

let offsetCache: OffsetCache | null = null;

function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Binary search to find byte offset where entries >= targetDate start
async function findOffsetForDate(file: ReturnType<typeof Bun.file>, targetDate: Date, fileSize: number): Promise<{ offset: number; firstLine: string }> {
  const t0 = performance.now();
  const targetTime = targetDate.getTime();

  let low = 0;
  let high = fileSize;
  let resultOffset = 0;
  let resultLine = '';
  let iterations = 0;

  // Binary search
  while (low < high) {
    iterations++;
    const mid = Math.floor((low + high) / 2);

    // Read a chunk around mid to find a complete line
    const chunkStart = Math.max(0, mid - 512);
    const chunkSize = Math.min(2048, fileSize - chunkStart);
    const chunk = await file.slice(chunkStart, chunkStart + chunkSize).text();

    // Find line boundaries
    const lines = chunk.split('\n');

    // If we started mid-line, skip first partial line (unless at file start)
    const startIdx = chunkStart === 0 ? 0 : 1;

    if (lines.length <= startIdx) {
      // No complete lines in chunk, move right
      low = mid + 1;
      continue;
    }

    const line = lines[startIdx];
    if (!line.trim()) {
      low = mid + 1;
      continue;
    }

    // Parse line to get timestamp
    const entry = parseLogLine(line);
    if (!entry) {
      low = mid + 1;
      continue;
    }

    const entryTime = new Date(entry.time).getTime();

    // Calculate actual byte offset of this line
    let lineOffset = chunkStart;
    for (let i = 0; i < startIdx; i++) {
      lineOffset += lines[i].length + 1; // +1 for newline
    }

    if (entryTime < targetTime) {
      // This entry is before target, search right
      low = lineOffset + line.length + 1;
    } else {
      // This entry is >= target, could be our answer, search left
      high = mid;
      resultOffset = lineOffset;
      resultLine = line;
    }
  }

  console.log(`[binarySearch] found offset ${resultOffset} in ${iterations} iterations, ${(performance.now() - t0).toFixed(1)}ms`);

  return { offset: resultOffset, firstLine: resultLine };
}

// Align offset to line boundary (read backwards to find newline)
async function alignToLineStart(file: ReturnType<typeof Bun.file>, offset: number): Promise<number> {
  if (offset === 0) return 0;

  // Read backwards to find newline
  const lookback = Math.min(1024, offset);
  const chunk = await file.slice(offset - lookback, offset).text();
  const lastNewline = chunk.lastIndexOf('\n');

  if (lastNewline === -1) {
    return offset - lookback;
  }

  return offset - lookback + lastNewline + 1;
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

  if (!(await file.exists())) {
    throw new Error(`Log file not found: ${LOG_FILE_PATH}`);
  }

  const stat = await file.stat();
  const fileSize = stat?.size || 0;

  // Default to today if no date range specified
  const effectiveFilter: LogFilter = {
    ...filter,
    from: filter.from ?? getTodayStart(),
    to: filter.to ?? getTodayEnd(),
  };

  const fromDate = effectiveFilter.from!;
  const fromDateKey = getDateKey(fromDate);

  // Try to use cached offset
  let startOffset = 0;
  let cacheHit = false;

  if (offsetCache && offsetCache.fromDate === fromDateKey && offsetCache.fileSize <= fileSize) {
    // Validate cache - check if line at offset is still the same
    const validationChunk = await file.slice(offsetCache.byteOffset, offsetCache.byteOffset + offsetCache.firstLine.length + 100).text();
    const firstLine = validationChunk.split('\n')[0];

    if (firstLine === offsetCache.firstLine) {
      startOffset = offsetCache.byteOffset;
      cacheHit = true;
      console.log(`[streamLogs] cache HIT for ${fromDateKey}, offset=${startOffset}`);
    } else {
      console.log(`[streamLogs] cache INVALID (line changed), will binary search`);
      offsetCache = null;
    }
  }

  // Binary search if no cache
  if (!cacheHit && fileSize > 1024 * 1024) { // Only for files > 1MB
    const t1 = performance.now();
    const { offset, firstLine } = await findOffsetForDate(file, fromDate, fileSize);
    startOffset = offset;
    console.log(`[streamLogs] binary search: ${(performance.now() - t1).toFixed(1)}ms, offset=${offset}`);

    // Update cache
    if (firstLine) {
      offsetCache = {
        fromDate: fromDateKey,
        byteOffset: offset,
        firstLine,
        fileSize,
      };
    }
  }

  const limit = effectiveFilter.limit || 1000;
  let count = 0;
  let buffer = '';
  let totalLines = 0;
  let skippedByFilter = 0;
  let chunkCount = 0;
  let totalBytes = 0;

  // Stream from calculated offset
  const slice = startOffset > 0 ? file.slice(startOffset) : file;
  const stream = slice.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const t2 = performance.now();

  console.log(`[streamLogs] starting from offset ${startOffset} (${(startOffset/1024/1024).toFixed(1)}MB into ${(fileSize/1024/1024).toFixed(1)}MB file)`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount++;
      totalBytes += value?.length || 0;

      if (chunkCount === 1) {
        console.log(`[streamLogs] first chunk: ${(performance.now() - t2).toFixed(1)}ms, ${value?.length} bytes`);
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
            console.log(`[streamLogs] first match: ${(performance.now() - t2).toFixed(1)}ms, after ${totalLines} lines`);
          }
          onEntry(entry);
          count++;
        } else {
          skippedByFilter++;
          // Early exit if we passed the 'to' date (logs are chronological)
          if (entry && effectiveFilter.to) {
            const entryTime = new Date(entry.time);
            if (entryTime > effectiveFilter.to) {
              console.log(`[streamLogs] passed 'to' date, stopping early`);
              break;
            }
          }
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

  console.log(`[streamLogs] done: ${(performance.now() - t0).toFixed(1)}ms total, ${chunkCount} chunks, ${(totalBytes/1024/1024).toFixed(1)}MB read, ${totalLines} lines, ${skippedByFilter} skipped, ${count} matched`);
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
