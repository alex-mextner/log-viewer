import { isAfter, isBefore, parseISO } from 'date-fns';

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
    if (!Number.isNaN(parsed.getTime())) return parsed;
    // Fallback to native Date
    const native = new Date(timeStr);
    if (!Number.isNaN(native.getTime())) return native;
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
  module?: string[];
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
export async function findOffsetForDate(
  file: ReturnType<typeof Bun.file>,
  targetDate: Date,
  fileSize: number
): Promise<{ offset: number; firstLine: string }> {
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
      // No newline in chunk - either very long line, end of file, or binary data
      // Try reading a larger chunk to find newline (logs can have huge base64 images)
      const largerChunkSize = Math.min(4 * 1024 * 1024, fileSize - mid); // 4MB
      if (largerChunkSize > chunkSize) {
        const largerChunk = await file.slice(mid, mid + largerChunkSize).text();
        const largerNewlinePos = largerChunk.indexOf('\n');
        if (largerNewlinePos !== -1) {
          // Found newline in larger chunk - continue with this data
          const restOfLargerChunk = largerChunk.slice(largerNewlinePos + 1);
          const nextNewlineInLarger = restOfLargerChunk.indexOf('\n');
          const lineFromLarger =
            nextNewlineInLarger === -1
              ? restOfLargerChunk
              : restOfLargerChunk.slice(0, nextNewlineInLarger);

          if (lineFromLarger.trim()) {
            const entryFromLarger = parseLogLineStrict(lineFromLarger);
            if (entryFromLarger) {
              const dateFromLarger = parseLogDate(entryFromLarger.time);
              if (dateFromLarger) {
                const cmpLarger = compareDates(dateFromLarger, targetDate);
                if (cmpLarger < 0) {
                  const newLow = mid + largerNewlinePos + 1 + lineFromLarger.length + 1;
                  console.log(
                    `[bs#${iterations}] mid=${mid}, found in 64KB: ${entryFromLarger.time} < target, low=${newLow}`
                  );
                  low = newLow;
                } else {
                  console.log(
                    `[bs#${iterations}] mid=${mid}, found in 64KB: ${entryFromLarger.time} >= target, high=${mid}`
                  );
                  high = mid;
                }
                continue;
              }
            }
          }
        }
      }
      // Still no newline or valid entry - this region is problematic
      // Move high down instead of low up to avoid skipping valid entries
      console.log(`[bs#${iterations}] mid=${mid}, no newline even in 64KB, high=${mid}`);
      high = mid;
      continue;
    }

    // Get the line AFTER the newline (first complete line)
    const restOfChunk = chunk.slice(newlinePos + 1);
    const nextNewline = restOfChunk.indexOf('\n');
    const line = nextNewline === -1 ? restOfChunk : restOfChunk.slice(0, nextNewline);

    if (!line.trim()) {
      console.log(`[bs#${iterations}] mid=${mid}, empty line, high=${mid}`);
      high = mid;
      continue;
    }

    // Use strict parsing - ignore non-JSON or lines without valid timestamp
    const entry = parseLogLineStrict(line);
    if (!entry) {
      // Non-JSON line - try to find next JSON line in chunk
      // Don't retreat (high=mid) as this could skip valid entries after non-JSON zone
      const remainingChunk = chunk.slice(newlinePos + 1);
      let foundJson = false;
      let searchOffset = mid + newlinePos + 1;

      for (const searchLine of remainingChunk.split('\n').slice(1)) {
        searchOffset += searchLine.length + 1;
        if (!searchLine.trim()) continue;
        const searchEntry = parseLogLineStrict(searchLine);
        if (searchEntry) {
          // Found JSON - use it for comparison
          const searchDate = parseLogDate(searchEntry.time);
          if (searchDate) {
            const searchCmp = compareDates(searchDate, targetDate);
            if (searchCmp < 0) {
              console.log(
                `[bs#${iterations}] mid=${mid}, found JSON after non-JSON: ${searchEntry.time} < target, low=${searchOffset}`
              );
              low = searchOffset;
            } else {
              console.log(
                `[bs#${iterations}] mid=${mid}, found JSON after non-JSON: ${searchEntry.time} >= target, high=${mid}`
              );
              high = mid;
            }
            foundJson = true;
            break;
          }
        }
      }

      if (!foundJson) {
        // No JSON found in chunk - move past this region
        console.log(`[bs#${iterations}] mid=${mid}, no JSON in chunk, low=${mid + chunkSize}`);
        low = mid + chunkSize;
      }
      continue;
    }

    const entryDate = parseLogDate(entry.time);
    // entryDate is guaranteed valid by parseLogLineStrict
    const cmp = compareDates(entryDate!, targetDate);

    if (cmp < 0) {
      // Entry is before target, search in right half
      const newLow = mid + newlinePos + 1;
      console.log(`[bs#${iterations}] mid=${mid}, entry=${entry.time} < target, low=${newLow}`);
      low = newLow;
    } else {
      // Entry is >= target, search in left half
      console.log(`[bs#${iterations}] mid=${mid}, entry=${entry.time} >= target, high=${mid}`);
      high = mid;
    }
  }

  // Linear scan from 'low' to find exact first entry >= targetDate
  // Use larger chunk to ensure we find the entry
  const scanSize = Math.min(65536 * 4, fileSize - low); // 256KB
  const scanChunk = await file.slice(low, low + scanSize).text();
  const lines = scanChunk.split('\n');

  let bestOffset = low;
  let bestLine = '';
  let offset = low;
  let scannedCount = 0;
  let foundAnyEntry = false;

  // If low > 0, first "line" is likely a partial line (tail of previous line)
  // Skip it and adjust offset
  const startIdx = low > 0 ? 1 : 0;
  if (low > 0 && lines[0]) {
    offset += lines[0].length + 1; // Skip partial line
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) {
      offset += (line?.length ?? 0) + 1;
      continue;
    }
    scannedCount++;
    // Use strict parsing - only consider lines with valid JSON timestamp
    const entry = parseLogLineStrict(line);
    if (entry) {
      foundAnyEntry = true;
      const entryDate = parseLogDate(entry.time);
      if (entryDate && compareDates(entryDate, targetDate) >= 0) {
        bestOffset = offset;
        bestLine = line;
        break;
      }
    }
    offset += line.length + 1;
  }

  if (!bestLine) {
    console.log(
      `[binarySearch] linear scan: ${scannedCount} lines, foundAnyEntry=${foundAnyEntry}, no match >= target`
    );
  }

  const foundEntry = parseLogLine(bestLine);
  const foundDate = foundEntry?.time ? parseLogDate(foundEntry.time) : null;
  console.log(
    `[binarySearch] low=${low}, bestOffset=${bestOffset}, iterations=${iterations}, ${(performance.now() - t0).toFixed(1)}ms`
  );
  console.log(
    `[binarySearch] target: ${targetDate.toISOString()}, found: ${foundDate?.toISOString() || 'none'}`
  );
  console.log(`[binarySearch] firstLine preview: ${bestLine.slice(0, 100)}...`);

  return { offset: bestOffset, firstLine: bestLine };
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

// Parse log line for binary search - only returns entry if it has valid JSON timestamp
// Returns null for non-JSON or entries without parseable time field
function parseLogLineStrict(line: string): LogEntry | null {
  if (!line.trim()) return null;

  try {
    const entry = JSON.parse(line) as LogEntry;
    // Must have a time field that can be parsed
    if (!entry.time) return null;
    const date = parseLogDate(entry.time);
    if (!date) return null;
    return entry;
  } catch {
    return null;
  }
}

export function filterLog(entry: LogEntry, filter: LogFilter): boolean {
  // Filter by level
  if (filter.level && filter.level.length > 0) {
    if (!filter.level.includes(entry.level)) {
      return false;
    }
  }

  // Filter by module
  if (filter.module && filter.module.length > 0) {
    if (!entry.module || !filter.module.includes(entry.module)) {
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

  // Only use from/to if specified - no defaults
  const fromDate = filter.from;
  const toDate = filter.to;

  // Try to use cached offset (only if we have a from date)
  let startOffset = 0;
  let cacheHit = false;

  if (fromDate) {
    if (
      offsetCache &&
      offsetCache.fileSize <= fileSize &&
      isCacheValidForDate(offsetCache, fromDate)
    ) {
      // Validate cache - check if line at offset is still the same
      const validationChunk = await file
        .slice(
          offsetCache.byteOffset,
          offsetCache.byteOffset + offsetCache.validationLine.length + 100
        )
        .text();
      const firstLine = validationChunk.split('\n')[0];

      if (firstLine === offsetCache.validationLine) {
        startOffset = offsetCache.byteOffset;
        cacheHit = true;
        console.log(
          `[streamLogs] cache HIT, offset=${startOffset}, cached=${new Date(offsetCache.fromTimestamp).toISOString()}, requested=${fromDate.toISOString()}`
        );
      } else {
        console.log(`[streamLogs] cache INVALID (line changed), will binary search`);
        offsetCache = null;
      }
    }

    // Binary search if no cache and file is large
    if (!cacheHit && fileSize > 1024 * 1024) {
      const t1 = performance.now();
      const { offset, firstLine } = await findOffsetForDate(file, fromDate, fileSize);
      startOffset = offset;
      console.log(
        `[streamLogs] binary search: ${(performance.now() - t1).toFixed(1)}ms, offset=${offset}`
      );

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
  } else {
    console.log(`[streamLogs] no from date filter, starting from beginning`);
  }

  const limit = filter.limit; // No default - show all if not specified
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

  console.log(
    `[streamLogs] starting from offset ${startOffset} (${(startOffset / 1024 / 1024).toFixed(1)}MB into ${(fileSize / 1024 / 1024).toFixed(1)}MB file)`
  );

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount++;
      totalBytes += value?.length || 0;

      if (chunkCount === 1) {
        console.log(
          `[streamLogs] first chunk: ${(performance.now() - t2).toFixed(1)}ms, ${value?.length} bytes`
        );
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        totalLines++;
        if (limit !== undefined && count >= limit) break;

        // Only process valid JSON entries with timestamp - skip broken/partial lines
        const entry = parseLogLineStrict(line);
        if (!entry) {
          skippedByFilter++;
          continue;
        }

        if (filterLog(entry, filter)) {
          if (count < 5) {
            console.log(
              `[streamLogs] match #${count}: time=${entry.time}, msg=${entry.msg?.slice(0, 50)}`
            );
          }
          if (count === 0) {
            console.log(
              `[streamLogs] first match: ${(performance.now() - t2).toFixed(1)}ms, after ${totalLines} lines`
            );
          }
          onEntry(entry);
          count++;
        } else {
          skippedByFilter++;
          // Early exit if we passed the 'to' date (logs are chronological)
          if (toDate) {
            const entryDate = parseLogDate(entry.time);
            if (entryDate && isAfter(entryDate, toDate)) {
              console.log(
                `[streamLogs] passed 'to' date (${entryDate.toISOString()} > ${toDate.toISOString()}), stopping early`
              );
              break;
            }
          }
        }
      }

      if (limit !== undefined && count >= limit) break;
    }

    // Process remaining buffer
    if ((limit === undefined || count < limit) && buffer.trim()) {
      totalLines++;
      const entry = parseLogLineStrict(buffer);
      if (entry && filterLog(entry, filter)) {
        onEntry(entry);
      }
    }
  } finally {
    reader.releaseLock();
  }

  console.log(
    `[streamLogs] done: ${(performance.now() - t0).toFixed(1)}ms total, ${chunkCount} chunks, ${(totalBytes / 1024 / 1024).toFixed(1)}MB read, ${totalLines} lines, ${skippedByFilter} skipped, ${count} matched`
  );
}

export async function readLogs(
  filter: LogFilter = {}
): Promise<{ logs: LogEntry[]; hasMore: boolean; total: number }> {
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

  const limit = effectiveFilter.limit; // No default - show all if not specified
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
  const logs =
    limit !== undefined
      ? matchedEntries.slice(offset, offset + limit)
      : matchedEntries.slice(offset);

  return {
    logs,
    hasMore: limit !== undefined && offset + limit < total,
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
