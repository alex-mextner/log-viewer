import { parseISO, isAfter, isBefore, isEqual } from 'date-fns';

export interface LogEntry {
  level: string;
  time: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

// Parse date from log entry - handles various formats
export function parseLogDate(timeStr: string): Date | null {
  if (!timeStr) return null;
  try {
    // Try ISO format first (most common)
    const parsed = parseISO(timeStr);
    if (!isNaN(parsed.getTime())) return parsed;
    // Fallback to native Date
    const native = new Date(timeStr);
    if (!isNaN(native.getTime())) return native;
    return null;
  } catch {
    return null;
  }
}

// Compare dates: returns -1 if a < b, 0 if equal, 1 if a > b
export function compareDates(a: Date, b: Date): number {
  if (isBefore(a, b)) return -1;
  if (isAfter(a, b)) return 1;
  return 0;
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
  fromTimestamp: number; // Full timestamp in ms for precise matching
  byteOffset: number;
  validationLine: string; // First line at offset for validation
  fileSize: number; // Invalidate if file shrunk (rotation)
}

let offsetCache: OffsetCache | null = null;

// Check if cached offset is still valid for this query
function isCacheValidForDate(cache: OffsetCache, fromDate: Date): boolean {
  // Cache is valid if:
  // 1. Cached fromTimestamp <= requested fromTimestamp (we can start from earlier point)
  // 2. Difference is less than 1 hour (don't use cache from days ago)
  const requestedTime = fromDate.getTime();
  const timeDiff = requestedTime - cache.fromTimestamp;
  return timeDiff >= 0 && timeDiff < 3600000; // Within 1 hour
}

// Binary search to find byte offset where entries >= targetDate start
export async function findOffsetForDate(file: ReturnType<typeof Bun.file>, targetDate: Date, fileSize: number): Promise<{ offset: number; firstLine: string }> {
  const t0 = performance.now();

  let low = 0;
  let high = fileSize;
  let iterations = 0;

  // Binary search to narrow down the range
  while (high - low > 65536) {
    iterations++;
    const mid = Math.floor((low + high) / 2);

    // Read chunk starting from mid, find first complete line
    const chunkSize = Math.min(4096, fileSize - mid);
    const chunk = await file.slice(mid, mid + chunkSize).text();
    const newlinePos = chunk.indexOf('\n');

    if (newlinePos === -1) {
      high = mid;
      continue;
    }

    // Get the line AFTER the newline (first complete line)
    const restOfChunk = chunk.slice(newlinePos + 1);
    const nextNewline = restOfChunk.indexOf('\n');
    const line = nextNewline === -1 ? restOfChunk : restOfChunk.slice(0, nextNewline);

    if (!line.trim()) {
      // Empty line, try going left
      high = mid;
      continue;
    }

    const entry = parseLogLine(line);
    if (!entry?.time) {
      high = mid;
      continue;
    }

    const entryDate = parseLogDate(entry.time);
    if (!entryDate) {
      high = mid;
      continue;
    }

    const cmp = compareDates(entryDate, targetDate);

    if (cmp < 0) {
      // Entry is before target, search in right half
      // Move low past this line
      low = mid + newlinePos + 1;
    } else {
      // Entry is >= target, search in left half
      // Keep mid in range so we don't skip past the answer
      high = mid;
    }
  }

  // Linear scan from 'low' to find exact first entry >= targetDate
  const scanChunk = await file.slice(low, Math.min(low + 65536 * 2, fileSize)).text();
  const lines = scanChunk.split('\n');

  let bestOffset = low;
  let bestLine = '';
  let offset = low;

  for (const line of lines) {
    if (!line.trim()) {
      offset += line.length + 1;
      continue;
    }
    const entry = parseLogLine(line);
    if (entry?.time) {
      const entryDate = parseLogDate(entry.time);
      if (entryDate && compareDates(entryDate, targetDate) >= 0) {
        bestOffset = offset;
        bestLine = line;
        break;
      }
    }
    offset += line.length + 1;
  }

  const foundEntry = parseLogLine(bestLine);
  const foundDate = foundEntry?.time ? parseLogDate(foundEntry.time) : null;
  console.log(`[binarySearch] found offset ${bestOffset} in ${iterations} iterations, ${(performance.now() - t0).toFixed(1)}ms`);
  console.log(`[binarySearch] target: ${targetDate.toISOString()}, found: ${foundDate?.toISOString() || 'none'}`);

  return { offset: bestOffset, firstLine: bestLine };
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
    const entryDate = parseLogDate(entry.time);
    if (!entryDate) return false;

    if (filter.from && isBefore(entryDate, filter.from)) {
      return false;
    }

    if (filter.to && isAfter(entryDate, filter.to)) {
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

  // Try to use cached offset
  let startOffset = 0;
  let cacheHit = false;

  if (offsetCache && offsetCache.fileSize <= fileSize && isCacheValidForDate(offsetCache, fromDate)) {
    // Validate cache - check if line at offset is still the same
    const validationChunk = await file.slice(offsetCache.byteOffset, offsetCache.byteOffset + offsetCache.validationLine.length + 100).text();
    const firstLine = validationChunk.split('\n')[0];

    if (firstLine === offsetCache.validationLine) {
      startOffset = offsetCache.byteOffset;
      cacheHit = true;
      console.log(`[streamLogs] cache HIT, offset=${startOffset}, cached=${new Date(offsetCache.fromTimestamp).toISOString()}, requested=${fromDate.toISOString()}`);
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
        fromTimestamp: fromDate.getTime(),
        byteOffset: offset,
        validationLine: firstLine,
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
            const entryDate = parseLogDate(entry.time);
            if (entryDate && isAfter(entryDate, effectiveFilter.to)) {
              console.log(`[streamLogs] passed 'to' date (${entryDate.toISOString()} > ${effectiveFilter.to.toISOString()}), stopping early`);
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
