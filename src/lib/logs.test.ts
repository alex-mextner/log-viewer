import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  parseLogDate,
  compareDates,
  findOffsetForDate,
  parseLogLine,
  filterLog,
  type LogEntry,
  type LogFilter,
} from './logs';

describe('parseLogDate', () => {
  test('parses ISO format with Z', () => {
    const date = parseLogDate('2025-12-14T10:30:00.000Z');
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2025-12-14T10:30:00.000Z');
  });

  test('parses ISO format without ms', () => {
    const date = parseLogDate('2025-12-14T10:30:00Z');
    expect(date).not.toBeNull();
    expect(date?.getUTCHours()).toBe(10);
    expect(date?.getUTCMinutes()).toBe(30);
  });

  test('parses ISO format without Z (local time)', () => {
    const date = parseLogDate('2025-12-14T10:30:00');
    expect(date).not.toBeNull();
    expect(date?.getHours()).toBe(10);
  });

  test('parses date with space instead of T', () => {
    const date = parseLogDate('2025-12-14 10:30:00');
    expect(date).not.toBeNull();
  });

  test('returns null for invalid date', () => {
    expect(parseLogDate('')).toBeNull();
    expect(parseLogDate('not-a-date')).toBeNull();
    expect(parseLogDate('invalid')).toBeNull();
  });
});

describe('compareDates', () => {
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

  test('compares dates across days', () => {
    const a = new Date('2025-12-13T23:59:59Z');
    const b = new Date('2025-12-14T00:00:00Z');
    expect(compareDates(a, b)).toBe(-1);
  });
});

describe('parseLogLine', () => {
  test('parses valid JSON log line', () => {
    const line = '{"level":"info","time":"2025-12-14T10:00:00Z","msg":"test message"}';
    const entry = parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry?.level).toBe('info');
    expect(entry?.time).toBe('2025-12-14T10:00:00Z');
    expect(entry?.msg).toBe('test message');
  });

  test('parses log line with module', () => {
    const line = '{"level":"error","time":"2025-12-14T10:00:00Z","module":"api","msg":"error"}';
    const entry = parseLogLine(line);
    expect(entry?.module).toBe('api');
  });

  test('wraps non-JSON lines as raw message', () => {
    const line = 'Plain text log message';
    const entry = parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry?.level).toBe('info');
    expect(entry?.msg).toBe('Plain text log message');
  });

  test('returns null for empty lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
  });
});

describe('filterLog', () => {
  const baseEntry: LogEntry = {
    level: 'info',
    time: '2025-12-14T12:00:00Z',
    msg: 'test',
  };

  test('passes entry with no filter', () => {
    expect(filterLog(baseEntry, {})).toBe(true);
  });

  test('filters by level', () => {
    expect(filterLog(baseEntry, { level: ['info'] })).toBe(true);
    expect(filterLog(baseEntry, { level: ['error'] })).toBe(false);
    expect(filterLog(baseEntry, { level: ['info', 'error'] })).toBe(true);
  });

  test('filters by from date', () => {
    const filter: LogFilter = { from: new Date('2025-12-14T10:00:00Z') };
    expect(filterLog(baseEntry, filter)).toBe(true);

    const filterAfter: LogFilter = { from: new Date('2025-12-14T13:00:00Z') };
    expect(filterLog(baseEntry, filterAfter)).toBe(false);
  });

  test('filters by to date', () => {
    const filter: LogFilter = { to: new Date('2025-12-14T15:00:00Z') };
    expect(filterLog(baseEntry, filter)).toBe(true);

    const filterBefore: LogFilter = { to: new Date('2025-12-14T10:00:00Z') };
    expect(filterLog(baseEntry, filterBefore)).toBe(false);
  });

  test('filters by date range', () => {
    const filter: LogFilter = {
      from: new Date('2025-12-14T10:00:00Z'),
      to: new Date('2025-12-14T15:00:00Z'),
    };
    expect(filterLog(baseEntry, filter)).toBe(true);

    const outsideFilter: LogFilter = {
      from: new Date('2025-12-14T13:00:00Z'),
      to: new Date('2025-12-14T15:00:00Z'),
    };
    expect(filterLog(baseEntry, outsideFilter)).toBe(false);
  });

  test('combines level and date filters', () => {
    const filter: LogFilter = {
      level: ['info'],
      from: new Date('2025-12-14T10:00:00Z'),
    };
    expect(filterLog(baseEntry, filter)).toBe(true);

    const noMatchFilter: LogFilter = {
      level: ['error'],
      from: new Date('2025-12-14T10:00:00Z'),
    };
    expect(filterLog(baseEntry, noMatchFilter)).toBe(false);
  });
});

describe('findOffsetForDate (binary search)', () => {
  const testDir = join(import.meta.dir, '__test_logs__');
  const testLogFile = join(testDir, 'test.log');

  // Generate test log file with entries spanning multiple days
  function generateTestLogs(): string {
    const lines: string[] = [];
    const dates = [
      // Dec 12 - early entries
      '2025-12-12T08:00:00.000Z',
      '2025-12-12T12:00:00.000Z',
      '2025-12-12T18:00:00.000Z',
      // Dec 13
      '2025-12-13T06:00:00.000Z',
      '2025-12-13T12:00:00.000Z',
      '2025-12-13T20:00:00.000Z',
      // Dec 14 - target date
      '2025-12-14T00:00:01.000Z',
      '2025-12-14T08:00:00.000Z',
      '2025-12-14T12:00:00.000Z',
      '2025-12-14T18:00:00.000Z',
      // Dec 15
      '2025-12-15T06:00:00.000Z',
      '2025-12-15T12:00:00.000Z',
      // Dec 16
      '2025-12-16T10:00:00.000Z',
    ];

    for (const time of dates) {
      lines.push(JSON.stringify({
        level: 'info',
        time,
        module: 'test',
        msg: `Log entry at ${time}`,
      }));
    }

    return lines.join('\n') + '\n';
  }

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testLogFile, generateTestLogs());
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('finds offset for date in middle of file', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // Search for Dec 14
    const targetDate = new Date('2025-12-14T00:00:00.000Z');
    const { offset, firstLine } = await findOffsetForDate(file, targetDate, fileSize);

    expect(offset).toBeGreaterThan(0);
    expect(firstLine).toContain('2025-12-14');

    // Verify the found line is actually >= target date
    const entry = parseLogLine(firstLine);
    expect(entry).not.toBeNull();
    const entryDate = parseLogDate(entry!.time);
    expect(entryDate).not.toBeNull();
    expect(compareDates(entryDate!, targetDate)).toBeGreaterThanOrEqual(0);
  });

  test('finds offset for date at start of file', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // Search for date before all entries
    const targetDate = new Date('2025-12-01T00:00:00.000Z');
    const { offset } = await findOffsetForDate(file, targetDate, fileSize);

    // Should return offset 0 (start of file)
    expect(offset).toBe(0);
  });

  test('finds offset for date at end of file', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // Search for Dec 16
    const targetDate = new Date('2025-12-16T00:00:00.000Z');
    const { offset, firstLine } = await findOffsetForDate(file, targetDate, fileSize);

    expect(firstLine).toContain('2025-12-16');
  });

  test('handles exact timestamp match', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // Search for exact timestamp
    const targetDate = new Date('2025-12-14T08:00:00.000Z');
    const { firstLine } = await findOffsetForDate(file, targetDate, fileSize);

    const entry = parseLogLine(firstLine);
    const entryDate = parseLogDate(entry!.time);
    expect(compareDates(entryDate!, targetDate)).toBeGreaterThanOrEqual(0);
  });

  test('returns correct offset for reading', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    const targetDate = new Date('2025-12-14T00:00:00.000Z');
    const { offset } = await findOffsetForDate(file, targetDate, fileSize);

    // Read from offset and verify first line
    const content = await file.slice(offset, offset + 200).text();
    const firstLine = content.split('\n')[0];
    const entry = parseLogLine(firstLine);

    expect(entry).not.toBeNull();
    expect(entry!.time).toContain('2025-12-14');
  });
});

describe('findOffsetForDate with large file', () => {
  const testDir = join(import.meta.dir, '__test_logs_large__');
  const testLogFile = join(testDir, 'large.log');

  // Generate larger test file (> 1MB to trigger binary search)
  function generateLargeLogs(): string {
    const lines: string[] = [];
    const startDate = new Date('2025-12-01T00:00:00.000Z');

    // Generate ~10000 entries over 15 days
    for (let i = 0; i < 10000; i++) {
      const time = new Date(startDate.getTime() + i * 120000); // Every 2 minutes
      lines.push(JSON.stringify({
        level: i % 10 === 0 ? 'error' : i % 3 === 0 ? 'warn' : 'info',
        time: time.toISOString(),
        module: 'test',
        msg: `Log entry ${i}: ${'x'.repeat(50)}`, // Pad to make file larger
      }));
    }

    return lines.join('\n') + '\n';
  }

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testLogFile, generateLargeLogs());
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test('binary search finds correct offset in large file', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // File should be > 1MB
    expect(fileSize).toBeGreaterThan(1024 * 1024);

    // Search for date in middle
    const targetDate = new Date('2025-12-08T00:00:00.000Z');
    const { offset, firstLine } = await findOffsetForDate(file, targetDate, fileSize);

    expect(offset).toBeGreaterThan(0);

    const entry = parseLogLine(firstLine);
    expect(entry).not.toBeNull();

    const entryDate = parseLogDate(entry!.time);
    expect(entryDate).not.toBeNull();
    expect(compareDates(entryDate!, targetDate)).toBeGreaterThanOrEqual(0);

    // Entry should be on or after Dec 8
    expect(entryDate!.getUTCDate()).toBeGreaterThanOrEqual(8);
  });

  test('binary search is efficient (limited iterations)', async () => {
    const file = Bun.file(testLogFile);
    const stat = await file.stat();
    const fileSize = stat?.size || 0;

    // For a file with 10000 entries, binary search should complete in ~15-20 iterations max
    // This is implicitly tested by the function completing quickly
    const startTime = performance.now();

    const targetDate = new Date('2025-12-10T12:00:00.000Z');
    await findOffsetForDate(file, targetDate, fileSize);

    const elapsed = performance.now() - startTime;

    // Should complete in under 100ms for local file
    expect(elapsed).toBeLessThan(100);
  });
});
