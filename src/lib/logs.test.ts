import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseLogDate,
  compareDates,
  findOffsetForDate,
  parseLogLine,
  filterLog,
  type LogEntry,
  type LogFilter,
} from './logs';

// ============================================================================
// UNIT TESTS: parseLogDate
// ============================================================================

describe('parseLogDate', () => {
  describe('ISO 8601 formats', () => {
    test('parses full ISO with milliseconds and Z', () => {
      const date = parseLogDate('2025-12-14T10:30:00.000Z');
      expect(date).not.toBeNull();
      expect(date?.toISOString()).toBe('2025-12-14T10:30:00.000Z');
    });

    test('parses ISO without milliseconds', () => {
      const date = parseLogDate('2025-12-14T10:30:00Z');
      expect(date).not.toBeNull();
      expect(date?.getUTCHours()).toBe(10);
      expect(date?.getUTCMinutes()).toBe(30);
    });

    test('parses ISO without Z (local time)', () => {
      const date = parseLogDate('2025-12-14T10:30:00');
      expect(date).not.toBeNull();
      expect(date?.getHours()).toBe(10);
    });

    test('parses ISO with timezone offset', () => {
      const date = parseLogDate('2025-12-14T10:30:00+03:00');
      expect(date).not.toBeNull();
      expect(date?.getUTCHours()).toBe(7); // 10:30 +03:00 = 07:30 UTC
    });

    test('parses ISO with negative timezone offset', () => {
      const date = parseLogDate('2025-12-14T10:30:00-05:00');
      expect(date).not.toBeNull();
      expect(date?.getUTCHours()).toBe(15); // 10:30 -05:00 = 15:30 UTC
    });
  });

  describe('alternative formats', () => {
    test('parses date with space instead of T', () => {
      const date = parseLogDate('2025-12-14 10:30:00');
      expect(date).not.toBeNull();
    });

    test('parses date-only string', () => {
      const date = parseLogDate('2025-12-14');
      expect(date).not.toBeNull();
      expect(date?.getUTCFullYear()).toBe(2025);
      expect(date?.getUTCMonth()).toBe(11); // December = 11
      expect(date?.getUTCDate()).toBe(14);
    });
  });

  describe('invalid inputs', () => {
    test('returns null for empty string', () => {
      expect(parseLogDate('')).toBeNull();
    });

    test('returns null for whitespace', () => {
      expect(parseLogDate('   ')).toBeNull();
    });

    test('returns null for garbage', () => {
      expect(parseLogDate('not-a-date')).toBeNull();
      expect(parseLogDate('invalid')).toBeNull();
      // Note: '12345' parses as year 12345 by date-fns, which is technically valid
    });

    test('handles partial dates (date-fns behavior)', () => {
      // date-fns parseISO handles these as valid partial dates
      // '2025' -> 2025-01-01, '2025-12' -> 2025-12-01
      const year = parseLogDate('2025');
      expect(year).not.toBeNull();
      expect(year?.getUTCFullYear()).toBe(2025);

      const yearMonth = parseLogDate('2025-12');
      expect(yearMonth).not.toBeNull();
      expect(yearMonth?.getUTCMonth()).toBe(11);
    });
  });

  describe('edge cases', () => {
    test('handles midnight', () => {
      const date = parseLogDate('2025-12-14T00:00:00.000Z');
      expect(date?.getUTCHours()).toBe(0);
      expect(date?.getUTCMinutes()).toBe(0);
    });

    test('handles end of day', () => {
      const date = parseLogDate('2025-12-14T23:59:59.999Z');
      expect(date?.getUTCHours()).toBe(23);
      expect(date?.getUTCMinutes()).toBe(59);
    });

    test('handles leap year date', () => {
      const date = parseLogDate('2024-02-29T12:00:00Z');
      expect(date).not.toBeNull();
      expect(date?.getUTCDate()).toBe(29);
    });
  });
});

// ============================================================================
// UNIT TESTS: compareDates
// ============================================================================

describe('compareDates', () => {
  describe('basic comparisons', () => {
    test('returns -1 when a < b', () => {
      const a = new Date('2025-12-14T10:00:00Z');
      const b = new Date('2025-12-14T11:00:00Z');
      expect(compareDates(a, b)).toBe(-1);
    });

    test('returns 1 when a > b', () => {
      const a = new Date('2025-12-14T12:00:00Z');
      const b = new Date('2025-12-14T11:00:00Z');
      expect(compareDates(a, b)).toBe(1);
    });

    test('returns 0 when a == b', () => {
      const a = new Date('2025-12-14T10:00:00Z');
      const b = new Date('2025-12-14T10:00:00Z');
      expect(compareDates(a, b)).toBe(0);
    });
  });

  describe('cross-boundary comparisons', () => {
    test('compares across day boundary', () => {
      const a = new Date('2025-12-13T23:59:59.999Z');
      const b = new Date('2025-12-14T00:00:00.000Z');
      expect(compareDates(a, b)).toBe(-1);
    });

    test('compares across month boundary', () => {
      const a = new Date('2025-11-30T23:59:59Z');
      const b = new Date('2025-12-01T00:00:00Z');
      expect(compareDates(a, b)).toBe(-1);
    });

    test('compares across year boundary', () => {
      const a = new Date('2024-12-31T23:59:59Z');
      const b = new Date('2025-01-01T00:00:00Z');
      expect(compareDates(a, b)).toBe(-1);
    });
  });

  describe('millisecond precision', () => {
    test('detects 1ms difference', () => {
      const a = new Date('2025-12-14T10:00:00.000Z');
      const b = new Date('2025-12-14T10:00:00.001Z');
      expect(compareDates(a, b)).toBe(-1);
    });

    test('equal with same milliseconds', () => {
      const a = new Date('2025-12-14T10:00:00.500Z');
      const b = new Date('2025-12-14T10:00:00.500Z');
      expect(compareDates(a, b)).toBe(0);
    });
  });
});

// ============================================================================
// UNIT TESTS: parseLogLine
// ============================================================================

describe('parseLogLine', () => {
  describe('valid JSON', () => {
    test('parses minimal log entry', () => {
      const line = '{"level":"info","time":"2025-12-14T10:00:00Z","msg":"test"}';
      const entry = parseLogLine(line);
      expect(entry).not.toBeNull();
      expect(entry?.level).toBe('info');
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
      expect(entry?.msg).toBe('test');
    });

    test('parses entry with module', () => {
      const line = '{"level":"error","time":"2025-12-14T10:00:00Z","module":"api","msg":"error"}';
      const entry = parseLogLine(line);
      expect(entry?.module).toBe('api');
    });

    test('parses entry with extra fields', () => {
      const line = '{"level":"info","time":"2025-12-14T10:00:00Z","msg":"test","userId":123,"action":"login"}';
      const entry = parseLogLine(line);
      expect(entry?.userId).toBe(123);
      expect(entry?.action).toBe('login');
    });

    test('handles nested objects', () => {
      const line = '{"level":"info","time":"2025-12-14T10:00:00Z","msg":"test","meta":{"key":"value"}}';
      const entry = parseLogLine(line);
      expect(entry?.meta).toEqual({ key: 'value' });
    });
  });

  describe('non-JSON fallback', () => {
    test('wraps plain text as raw message', () => {
      const line = 'Plain text log message';
      const entry = parseLogLine(line);
      expect(entry).not.toBeNull();
      expect(entry?.level).toBe('info');
      expect(entry?.msg).toBe('Plain text log message');
      expect(entry?.time).toBeDefined();
    });

    test('handles malformed JSON', () => {
      const line = '{"level":"info", broken json';
      const entry = parseLogLine(line);
      expect(entry).not.toBeNull();
      expect(entry?.msg).toBe('{"level":"info", broken json');
    });
  });

  describe('empty/whitespace', () => {
    test('returns null for empty string', () => {
      expect(parseLogLine('')).toBeNull();
    });

    test('returns null for whitespace only', () => {
      expect(parseLogLine('   ')).toBeNull();
      expect(parseLogLine('\t')).toBeNull();
      expect(parseLogLine('\n')).toBeNull();
    });
  });
});

// ============================================================================
// UNIT TESTS: filterLog
// ============================================================================

describe('filterLog', () => {
  const baseEntry: LogEntry = {
    level: 'info',
    time: '2025-12-14T12:00:00Z',
    msg: 'test message',
  };

  describe('no filter', () => {
    test('passes any entry with empty filter', () => {
      expect(filterLog(baseEntry, {})).toBe(true);
    });

    test('passes entry with undefined filter values', () => {
      expect(filterLog(baseEntry, { level: undefined, from: undefined, to: undefined })).toBe(true);
    });
  });

  describe('level filter', () => {
    test('matches single level', () => {
      expect(filterLog(baseEntry, { level: ['info'] })).toBe(true);
      expect(filterLog(baseEntry, { level: ['error'] })).toBe(false);
    });

    test('matches multiple levels', () => {
      expect(filterLog(baseEntry, { level: ['info', 'error'] })).toBe(true);
      expect(filterLog(baseEntry, { level: ['warn', 'error'] })).toBe(false);
    });

    test('empty level array passes all', () => {
      expect(filterLog(baseEntry, { level: [] })).toBe(true);
    });

    test('case sensitive level matching', () => {
      expect(filterLog(baseEntry, { level: ['INFO'] })).toBe(false);
      expect(filterLog(baseEntry, { level: ['Info'] })).toBe(false);
    });
  });

  describe('from filter', () => {
    test('includes entry at exact from time', () => {
      const filter: LogFilter = { from: new Date('2025-12-14T12:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('includes entry after from time', () => {
      const filter: LogFilter = { from: new Date('2025-12-14T10:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('excludes entry before from time', () => {
      const filter: LogFilter = { from: new Date('2025-12-14T13:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });

    test('handles from at start of day', () => {
      const filter: LogFilter = { from: new Date('2025-12-14T00:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });
  });

  describe('to filter', () => {
    test('includes entry at exact to time', () => {
      const filter: LogFilter = { to: new Date('2025-12-14T12:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('includes entry before to time', () => {
      const filter: LogFilter = { to: new Date('2025-12-14T15:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('excludes entry after to time', () => {
      const filter: LogFilter = { to: new Date('2025-12-14T10:00:00Z') };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });

    test('handles to at end of day', () => {
      const filter: LogFilter = { to: new Date('2025-12-14T23:59:59.999Z') };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });
  });

  describe('date range (from + to)', () => {
    test('includes entry within range', () => {
      const filter: LogFilter = {
        from: new Date('2025-12-14T10:00:00Z'),
        to: new Date('2025-12-14T15:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('includes entry at range boundaries', () => {
      const filter: LogFilter = {
        from: new Date('2025-12-14T12:00:00Z'),
        to: new Date('2025-12-14T12:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('excludes entry before range', () => {
      const filter: LogFilter = {
        from: new Date('2025-12-14T13:00:00Z'),
        to: new Date('2025-12-14T15:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });

    test('excludes entry after range', () => {
      const filter: LogFilter = {
        from: new Date('2025-12-14T08:00:00Z'),
        to: new Date('2025-12-14T10:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });
  });

  describe('combined filters', () => {
    test('applies both level and date filters', () => {
      const filter: LogFilter = {
        level: ['info'],
        from: new Date('2025-12-14T10:00:00Z'),
        to: new Date('2025-12-14T15:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(true);
    });

    test('fails if level doesnt match but date does', () => {
      const filter: LogFilter = {
        level: ['error'],
        from: new Date('2025-12-14T10:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });

    test('fails if date doesnt match but level does', () => {
      const filter: LogFilter = {
        level: ['info'],
        from: new Date('2025-12-14T15:00:00Z'),
      };
      expect(filterLog(baseEntry, filter)).toBe(false);
    });
  });

  describe('invalid entry time', () => {
    test('rejects entry with invalid time when date filter present', () => {
      const invalidEntry: LogEntry = { level: 'info', time: 'invalid', msg: 'test' };
      const filter: LogFilter = { from: new Date('2025-12-14T00:00:00Z') };
      expect(filterLog(invalidEntry, filter)).toBe(false);
    });

    test('passes entry with invalid time when no date filter', () => {
      const invalidEntry: LogEntry = { level: 'info', time: 'invalid', msg: 'test' };
      expect(filterLog(invalidEntry, {})).toBe(true);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS: findOffsetForDate (Binary Search)
// ============================================================================

describe('findOffsetForDate', () => {
  const testDir = join(import.meta.dir, '__test_logs__');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // Helper to create log entry
  function logEntry(time: string, msg = 'test'): string {
    return JSON.stringify({ level: 'info', time, module: 'test', msg });
  }

  // Helper to create test file and return Bun.file reference
  async function createTestFile(name: string, content: string) {
    const path = join(testDir, name);
    writeFileSync(path, content);
    const file = Bun.file(path);
    const stat = await file.stat();
    return { file, size: stat?.size || 0, path };
  }

  describe('small files (linear scan only)', () => {
    test('finds entry in small file', async () => {
      const content = [
        logEntry('2025-12-12T10:00:00Z'),
        logEntry('2025-12-13T10:00:00Z'),
        logEntry('2025-12-14T10:00:00Z'),
        logEntry('2025-12-15T10:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('small.log', content);
      const target = new Date('2025-12-14T00:00:00Z');
      const { offset, firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });

    test('returns offset 0 when target is before all entries', async () => {
      const content = [
        logEntry('2025-12-14T10:00:00Z'),
        logEntry('2025-12-15T10:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('before_all.log', content);
      const target = new Date('2025-12-01T00:00:00Z');
      const { offset, firstLine } = await findOffsetForDate(file, target, size);

      expect(offset).toBe(0);
      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });

    test('returns last valid position when target is after all entries', async () => {
      const content = [
        logEntry('2025-12-12T10:00:00Z'),
        logEntry('2025-12-13T10:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('after_all.log', content);
      const target = new Date('2025-12-20T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      // Should return empty or no match since all entries are before target
      expect(firstLine).toBe('');
    });

    test('handles single entry file', async () => {
      const content = logEntry('2025-12-14T10:00:00Z') + '\n';

      const { file, size } = await createTestFile('single.log', content);
      const target = new Date('2025-12-14T00:00:00Z');
      const { offset, firstLine } = await findOffsetForDate(file, target, size);

      expect(offset).toBe(0);
      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });

    test('handles empty file', async () => {
      const { file, size } = await createTestFile('empty.log', '');
      const target = new Date('2025-12-14T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      expect(firstLine).toBe('');
    });
  });

  describe('medium files (forces some binary search iterations)', () => {
    // Create file > 65KB to trigger binary search
    function generateMediumLogs(entryCount: number, startDate: Date, intervalMs: number): string {
      const lines: string[] = [];
      for (let i = 0; i < entryCount; i++) {
        const time = new Date(startDate.getTime() + i * intervalMs);
        // Pad message to make file larger
        lines.push(logEntry(time.toISOString(), `Entry ${i} ${'x'.repeat(100)}`));
      }
      return lines.join('\n') + '\n';
    }

    test('finds target date in middle of file', async () => {
      // Generate ~500 entries, each ~150 bytes = ~75KB
      const startDate = new Date('2025-12-01T00:00:00Z');
      const content = generateMediumLogs(500, startDate, 3600000); // 1 hour intervals

      const { file, size } = await createTestFile('medium_middle.log', content);
      expect(size).toBeGreaterThan(65536);

      // Target: Dec 10 (entry ~216)
      const target = new Date('2025-12-10T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
      expect(entryDate!.getUTCDate()).toBe(10);
    });

    test('finds target date near start of file', async () => {
      const startDate = new Date('2025-12-01T00:00:00Z');
      const content = generateMediumLogs(500, startDate, 3600000);

      const { file, size } = await createTestFile('medium_start.log', content);

      // Target: Dec 2 (near start)
      const target = new Date('2025-12-02T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
    });

    test('finds target date near end of file', async () => {
      const startDate = new Date('2025-12-01T00:00:00Z');
      const content = generateMediumLogs(500, startDate, 3600000);

      const { file, size } = await createTestFile('medium_end.log', content);

      // Target: Dec 20 (near end)
      const target = new Date('2025-12-20T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('large files (real binary search)', () => {
    // Generate file > 1MB with many entries
    function generateLargeLogs(): string {
      const lines: string[] = [];
      const startDate = new Date('2025-12-01T00:00:00Z');

      // 10000 entries * ~150 bytes = ~1.5MB
      for (let i = 0; i < 10000; i++) {
        const time = new Date(startDate.getTime() + i * 120000); // 2 min intervals
        lines.push(logEntry(time.toISOString(), `Log entry ${i}: ${'x'.repeat(100)}`));
      }
      return lines.join('\n') + '\n';
    }

    test('binary search correctly finds date in large file', async () => {
      const content = generateLargeLogs();
      const { file, size } = await createTestFile('large.log', content);

      expect(size).toBeGreaterThan(1024 * 1024);

      // Target: Dec 8 (middle of file)
      const target = new Date('2025-12-08T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // Must be >= target
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);

      // Should be Dec 8 (not Dec 9 or later)
      expect(entryDate!.getUTCDate()).toBe(8);
    });

    test('binary search efficient - limited iterations', async () => {
      const content = generateLargeLogs();
      const { file, size } = await createTestFile('large_perf.log', content);

      const startTime = performance.now();
      const target = new Date('2025-12-10T12:00:00Z');
      await findOffsetForDate(file, target, size);
      const elapsed = performance.now() - startTime;

      // Should complete in under 50ms for local file
      expect(elapsed).toBeLessThan(50);
    });

    test('multiple searches return consistent results', async () => {
      const content = generateLargeLogs();
      const { file, size } = await createTestFile('large_consistent.log', content);

      const target = new Date('2025-12-07T06:00:00Z');

      // Run same search 3 times
      const results = await Promise.all([
        findOffsetForDate(file, target, size),
        findOffsetForDate(file, target, size),
        findOffsetForDate(file, target, size),
      ]);

      // All should return same offset
      expect(results[0].offset).toBe(results[1].offset);
      expect(results[1].offset).toBe(results[2].offset);
    });
  });

  describe('edge cases and boundary conditions', () => {
    test('exact timestamp match', async () => {
      const content = [
        logEntry('2025-12-14T08:00:00.000Z'),
        logEntry('2025-12-14T09:00:00.000Z'),
        logEntry('2025-12-14T10:00:00.000Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('exact_match.log', content);
      const target = new Date('2025-12-14T09:00:00.000Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T09:00:00.000Z');
    });

    test('target between two entries', async () => {
      const content = [
        logEntry('2025-12-14T08:00:00Z'),
        logEntry('2025-12-14T10:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('between.log', content);
      // Target is 09:00, between 08:00 and 10:00
      const target = new Date('2025-12-14T09:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      // Should return 10:00 (first entry >= target)
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });

    test('handles entries with same timestamp', async () => {
      const content = [
        logEntry('2025-12-14T10:00:00Z', 'first'),
        logEntry('2025-12-14T10:00:00Z', 'second'),
        logEntry('2025-12-14T10:00:00Z', 'third'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('same_time.log', content);
      const target = new Date('2025-12-14T10:00:00Z');
      const { offset } = await findOffsetForDate(file, target, size);

      // Should return first occurrence
      expect(offset).toBe(0);
    });

    test('handles very long log lines', async () => {
      const longMsg = 'x'.repeat(5000);
      const content = [
        logEntry('2025-12-13T10:00:00Z', longMsg),
        logEntry('2025-12-14T10:00:00Z', longMsg),
        logEntry('2025-12-15T10:00:00Z', longMsg),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('long_lines.log', content);
      const target = new Date('2025-12-14T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });

    test('handles non-JSON lines mixed with JSON', async () => {
      const content = [
        'Some non-JSON header line',
        logEntry('2025-12-13T10:00:00Z'),
        '--- separator ---',
        logEntry('2025-12-14T10:00:00Z'),
        'Another text line',
        logEntry('2025-12-15T10:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('mixed.log', content);
      const target = new Date('2025-12-14T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    });
  });

  describe('realistic scenarios', () => {
    test('simulates daily log rotation - find today in week of logs', async () => {
      const lines: string[] = [];
      // Dec 10-16, ~100 entries per day
      for (let day = 10; day <= 16; day++) {
        for (let hour = 0; hour < 24; hour += 4) {
          for (let min = 0; min < 60; min += 15) {
            const time = `2025-12-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00Z`;
            lines.push(logEntry(time, `Entry for ${time}`));
          }
        }
      }
      const content = lines.join('\n') + '\n';

      const { file, size } = await createTestFile('weekly.log', content);

      // Find Dec 14 entries
      const target = new Date('2025-12-14T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);

      expect(entryDate!.getUTCDate()).toBe(14);
      expect(entryDate!.getUTCHours()).toBe(0);
      expect(entryDate!.getUTCMinutes()).toBe(0);
    });

    test('handles gaps in log timestamps', async () => {
      const content = [
        logEntry('2025-12-10T10:00:00Z'),
        logEntry('2025-12-10T11:00:00Z'),
        // Gap: Dec 11-13 missing
        logEntry('2025-12-14T08:00:00Z'),
        logEntry('2025-12-14T09:00:00Z'),
      ].join('\n') + '\n';

      const { file, size } = await createTestFile('gaps.log', content);

      // Search for Dec 12 (doesn't exist)
      const target = new Date('2025-12-12T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      // Should return first entry >= Dec 12, which is Dec 14
      expect(entry?.time).toBe('2025-12-14T08:00:00Z');
    });

    test('burst of logs at same second', async () => {
      const lines: string[] = [];
      // 100 logs at same second
      for (let i = 0; i < 100; i++) {
        lines.push(logEntry(`2025-12-14T10:00:00.${i.toString().padStart(3, '0')}Z`, `Burst ${i}`));
      }
      const content = lines.join('\n') + '\n';

      const { file, size } = await createTestFile('burst.log', content);
      const target = new Date('2025-12-14T10:00:00.050Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('regression tests', () => {
    // Test with REAL 612MB log file
    test('REAL FILE: binary search on 612MB log file', async () => {
      const realLogPath = '/Users/ultra/Downloads/psy_froggy_bot-out.log';
      const file = Bun.file(realLogPath);

      if (!(await file.exists())) {
        console.log('Skipping real file test - file not found');
        return;
      }

      const stat = await file.stat();
      const size = stat?.size || 0;
      console.log(`Real file: ${(size / 1024 / 1024).toFixed(1)}MB`);

      // Target: today 00:00 UTC
      const target = new Date('2025-12-16T00:00:00.000Z');
      const t0 = performance.now();
      const { firstLine, offset } = await findOffsetForDate(file, target, size);
      const elapsed = performance.now() - t0;

      console.log(`Binary search: ${elapsed.toFixed(1)}ms, offset=${offset}`);

      const entry = parseLogLine(firstLine);
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // Should find entry on Dec 16
      expect(entryDate!.getUTCDate()).toBe(16);
      expect(entryDate!.getUTCMonth()).toBe(11); // December

      // Should be fast (< 100ms for binary search)
      expect(elapsed).toBeLessThan(100);
    });

    // BUG: Non-JSON lines (stack traces, separator) cause binary search to retreat to high=mid
    // This can leave linear scan starting before a large gap
    test('REGRESSION: non-JSON gap > 256KB causes found=none', async () => {
      const lines: string[] = [];

      // Dec 1-14: normal JSON entries
      for (let day = 1; day <= 14; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const hh = hour.toString().padStart(2, '0');
          const dd = day.toString().padStart(2, '0');
          lines.push(logEntry(`2025-12-${dd}T${hh}:00:00.000Z`, `Day${dd}_${hh}: ${'x'.repeat(100)}`));
        }
      }

      // Dec 15 end: a few entries then HUGE non-JSON gap (stack traces, separator lines)
      for (let hour = 0; hour < 12; hour++) {
        const hh = hour.toString().padStart(2, '0');
        lines.push(logEntry(`2025-12-15T${hh}:00:00.000Z`, `Day15_${hh}: ${'x'.repeat(100)}`));
      }

      // 400KB of non-JSON lines (simulating stack trace dump or corrupt data)
      for (let i = 0; i < 3000; i++) {
        // ~130 bytes each * 3000 = ~390KB of non-JSON
        lines.push(`--- Stack trace line ${i.toString().padStart(4, '0')}: ${'ERROR '.repeat(15)} ---`);
      }

      // Dec 16: starts after the non-JSON gap
      for (let hour = 5; hour < 24; hour++) {
        const hh = hour.toString().padStart(2, '0');
        lines.push(logEntry(`2025-12-16T${hh}:00:00.000Z`, `Day16_${hh}: ${'x'.repeat(100)}`));
      }

      const content = lines.join('\n') + '\n';
      const { file, size } = await createTestFile('regression_nonjson_gap.log', content);

      // Target: Dec 15 23:00 UTC
      // Binary search might land in non-JSON zone and retreat to Dec 15 12:00 area
      // Linear scan 256KB won't reach Dec 16 if gap is > 256KB
      const target = new Date('2025-12-15T23:00:00.000Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      // BUG: If firstLine is empty, we return "found: none"
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // Must find Dec 16 05:00
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
      expect(entryDate!.getUTCDate()).toBe(16);
    });

    // BUG: Binary search finds position, but gap to first entry >= target is > 256KB linear scan
    // This causes "found: none" because linear scan doesn't reach the target entry
    test('REGRESSION: large gap > 256KB between last entry < target and first entry >= target', async () => {
      const lines: string[] = [];

      // Create file where:
      // 1. Many entries for Dec 1-14 (all < target)
      // 2. MANY entries at Dec 15 20:30 (> 256KB worth, all still < target)
      // 3. Few entries at Dec 16 05:00 (first >= target)
      // Binary search should land in Dec 15 zone, 256KB scan won't reach Dec 16

      // Dec 1-14: one entry per hour
      for (let day = 1; day <= 14; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const hh = hour.toString().padStart(2, '0');
          const dd = day.toString().padStart(2, '0');
          lines.push(logEntry(`2025-12-${dd}T${hh}:00:00.000Z`, `Day${dd}_${hh}: ${'x'.repeat(100)}`));
        }
      }

      // Dec 15: HUGE number of entries at 20:30 (making >600KB of entries all at same timestamp)
      // This simulates a burst of activity before shutdown
      // Binary search will land somewhere in the middle, leaving >256KB to scan
      for (let i = 0; i < 4000; i++) {
        // ~160 bytes each * 4000 = ~640KB all at Dec 15 20:30
        lines.push(logEntry(`2025-12-15T20:30:00.${i.toString().padStart(4, '0')}Z`, `Dec15_burst_${i.toString().padStart(4, '0')}: ${'y'.repeat(100)}`));
      }

      // GAP: No entries between Dec 15 20:30.999 and Dec 16 05:00

      // Dec 16: starts at 05:00 UTC
      for (let hour = 5; hour < 24; hour++) {
        const hh = hour.toString().padStart(2, '0');
        lines.push(logEntry(`2025-12-16T${hh}:00:00.000Z`, `Day16_${hh}: ${'x'.repeat(100)}`));
      }

      const content = lines.join('\n') + '\n';
      const { file, size } = await createTestFile('regression_large_gap.log', content);

      // Target: Dec 15 23:00 UTC
      // Binary search will land somewhere in the Dec 15 20:30 burst
      // 256KB linear scan must be able to skip past all burst entries and find Dec 16
      const target = new Date('2025-12-15T23:00:00.000Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      // If this is null or entry is from Dec 15, the bug is reproduced!
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // CRITICAL: Must find Dec 16 05:00, NOT stay stuck in Dec 15 burst
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
      expect(entryDate!.getUTCDate()).toBe(16);
    });

    // Test: large file (5MB+) with target near end and gap in timestamps
    test('REGRESSION: large file - target 00:00 but first log at 05:00', async () => {
      // Simulate: 612MB file = ~2.2M lines, ~280 bytes/line
      // Test with: 5MB file = ~20K lines, ~250 bytes/line
      const lines: string[] = [];

      // Create many days of logs before "today" (Dec 16)
      // Days 1-15: ~1300 entries/day = 19500 entries total
      for (let day = 1; day <= 15; day++) {
        for (let i = 0; i < 1300; i++) {
          const hour = Math.floor(i / 60) % 24;
          const min = i % 60;
          const hh = hour.toString().padStart(2, '0');
          const mm = min.toString().padStart(2, '0');
          const dd = day.toString().padStart(2, '0');
          // ~250 bytes per line
          lines.push(logEntry(`2025-12-${dd}T${hh}:${mm}:00.000Z`, `Day${dd}_${hh}${mm}_${i}: ${'x'.repeat(170)}`));
        }
      }

      // Dec 16: starts at 05:00 (gap from 00:00 to 05:00)
      for (let i = 0; i < 500; i++) {
        const hour = 5 + Math.floor(i / 60);
        const min = i % 60;
        if (hour >= 24) break;
        const hh = hour.toString().padStart(2, '0');
        const mm = min.toString().padStart(2, '0');
        lines.push(logEntry(`2025-12-16T${hh}:${mm}:00.000Z`, `Day16_${hh}${mm}_${i}: ${'x'.repeat(170)}`));
      }

      const content = lines.join('\n') + '\n';
      const { file, size } = await createTestFile('regression_large_gap.log', content);

      // Verify file is large enough for real binary search
      expect(size).toBeGreaterThan(4 * 1024 * 1024); // > 4MB

      // Target: Dec 16 00:00 UTC (but first log is Dec 16 05:00)
      const target = new Date('2025-12-16T00:00:00.000Z');
      const t0 = performance.now();
      const { firstLine } = await findOffsetForDate(file, target, size);
      const elapsed = performance.now() - t0;

      // Should be fast even for large file
      expect(elapsed).toBeLessThan(100); // < 100ms

      const entry = parseLogLine(firstLine);
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // CRITICAL: Must find Dec 16 05:00 (first entry >= target)
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
      expect(entryDate!.getUTCDate()).toBe(16);
      expect(entryDate!.getUTCHours()).toBe(5);
    });

    // Test: binary search lands too far from target, 256KB linear scan not enough
    test('REGRESSION: linear scan chunk too small - should still find entry', async () => {
      // Create file where:
      // 1. Many short entries per second (high density)
      // 2. Binary search might land 300KB before first matching entry
      // 3. 256KB linear scan would miss the target
      const lines: string[] = [];

      // Dec 15: dense entries (many per minute) - creates ~800KB
      for (let hour = 0; hour < 24; hour++) {
        for (let min = 0; min < 60; min++) {
          for (let sec = 0; sec < 10; sec++) {
            const hh = hour.toString().padStart(2, '0');
            const mm = min.toString().padStart(2, '0');
            const ss = sec.toString().padStart(2, '0');
            // Short entries ~60 bytes each, ~14400 entries = ~864KB for Dec 15
            lines.push(logEntry(`2025-12-15T${hh}:${mm}:${ss}.000Z`, `D15_${hh}${mm}${ss}`));
          }
        }
      }

      // Dec 16: starts at 05:00
      for (let hour = 5; hour < 24; hour++) {
        for (let min = 0; min < 60; min++) {
          const hh = hour.toString().padStart(2, '0');
          const mm = min.toString().padStart(2, '0');
          lines.push(logEntry(`2025-12-16T${hh}:${mm}:00.000Z`, `D16_${hh}${mm}`));
        }
      }

      const content = lines.join('\n') + '\n';
      const { file, size } = await createTestFile('regression_dense.log', content);

      // Target: Dec 16 00:00 (but first log is Dec 16 05:00)
      // Binary search might land deep in Dec 15, 256KB not enough to reach Dec 16
      const target = new Date('2025-12-16T00:00:00.000Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      expect(entry).not.toBeNull();

      const entryDate = parseLogDate(entry!.time);
      expect(entryDate).not.toBeNull();

      // Must find Dec 16 entry, not stay stuck in Dec 15
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
      expect(entryDate!.getUTCDate()).toBe(16);
    });

    // This test would have caught the original bug
    test('REGRESSION: large file with target date in first half', async () => {
      const lines: string[] = [];
      // Generate 5000 entries over 10 days (Dec 6-15)
      // Each day ~500 entries
      for (let i = 0; i < 5000; i++) {
        const dayOffset = Math.floor(i / 500);
        const hourOffset = (i % 500) * 0.048; // ~48 entries per hour
        const date = new Date('2025-12-06T00:00:00Z');
        date.setUTCDate(date.getUTCDate() + dayOffset);
        date.setUTCHours(Math.floor(hourOffset));
        date.setUTCMinutes(Math.floor((hourOffset % 1) * 60));

        lines.push(logEntry(date.toISOString(), `Entry ${i}: ${'x'.repeat(80)}`));
      }
      const content = lines.join('\n') + '\n';

      const { file, size } = await createTestFile('regression_first_half.log', content);
      expect(size).toBeGreaterThan(65536);

      // Target: Dec 8 - in first third of file
      const target = new Date('2025-12-08T00:00:00Z');
      const { firstLine } = await findOffsetForDate(file, target, size);

      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);

      // CRITICAL: Must find Dec 8, not a later date
      expect(entryDate!.getUTCDate()).toBe(8);
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);
    });

    test('REGRESSION: returns correct offset for sequential reads', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        const time = new Date('2025-12-01T00:00:00Z');
        time.setUTCHours(Math.floor(i / 60));
        time.setUTCMinutes(i % 60);
        lines.push(logEntry(time.toISOString(), `Entry ${i}`));
      }
      const content = lines.join('\n') + '\n';

      const { file, size } = await createTestFile('regression_offset.log', content);

      const target = new Date('2025-12-01T05:30:00Z');
      const { offset } = await findOffsetForDate(file, target, size);

      // Read from offset and verify
      const readContent = await file.slice(offset, offset + 500).text();
      const firstLine = readContent.split('\n')[0];
      const entry = parseLogLine(firstLine);
      const entryDate = parseLogDate(entry!.time);

      // Entry at offset should be >= target
      expect(compareDates(entryDate!, target)).toBeGreaterThanOrEqual(0);

      // And should be close to target (within ~1 hour)
      const diffMs = entryDate!.getTime() - target.getTime();
      expect(diffMs).toBeLessThan(3600000); // Less than 1 hour difference
    });
  });
});
