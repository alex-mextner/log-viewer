import { renderToString } from 'react-dom/server';
import type { LogEntry } from './logs';

// Lightweight SSR components - no hooks, no client-side code

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

const LEVEL_BG_COLORS: Record<string, string> = {
  debug: 'bg-gray-500',
  info: 'bg-blue-500',
  warn: 'bg-yellow-500',
  error: 'bg-red-500',
};

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

// Magic marker for splitting HTML
const LOGS_PLACEHOLDER = '<!--__LOGS_STREAM__-->';

function formatTime(time: string): string {
  try {
    const date = new Date(time);
    return date.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return time;
  }
}

// Escape HTML special chars
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pure HTML string for a log row (for streaming)
// data-log-item contains JSON for React hydration
export function logRowToHtml(entry: LogEntry): string {
  const levelColor = LEVEL_COLORS[entry.level] || 'text-gray-400';
  const time = formatTime(entry.time);
  const module = entry.module || '-';
  const msg = escapeHtml(entry.msg || '');
  const json = escapeHtml(JSON.stringify(entry));

  return `<div class="flex gap-2 px-2 py-0.5 hover:bg-accent cursor-pointer text-sm font-mono" data-log-item="${json}"><span class="text-muted-foreground shrink-0">${time}</span><span class="shrink-0 w-12 uppercase ${levelColor}">${entry.level}</span><span class="text-muted-foreground shrink-0 w-24 truncate">${module}</span><span class="truncate">${msg}</span></div>`;
}

// SSR-only filter components (no handlers, just UI shell)
function SSRDateFilter() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="from" className="text-sm whitespace-nowrap">
          From:
        </label>
        <input
          id="from"
          type="datetime-local"
          className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          readOnly
        />
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="to" className="text-sm whitespace-nowrap">
          To:
        </label>
        <input
          id="to"
          type="datetime-local"
          className="flex h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          readOnly
        />
      </div>
    </div>
  );
}

function SSRLevelFilter() {
  return (
    <div className="flex items-center gap-2">
      <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium bg-primary text-primary-foreground h-9 px-3">
        All
      </button>
      {LEVELS.map((level) => (
        <button
          key={level}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium bg-primary text-primary-foreground h-9 px-3"
        >
          <span className={`w-2 h-2 rounded-full ${LEVEL_BG_COLORS[level]}`} />
          {level.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const LIMIT_OPTIONS = [100, 500, 1000, 5000];

// SSR pagination - suppressHydrationWarning because client uses Button component with different attrs
function SSRPagination({ total }: { total: number }) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap" suppressHydrationWarning>
      <span className="text-muted-foreground">{total} entries</span>
      <span className="text-muted-foreground">|</span>
      <span className="text-muted-foreground">Per page:</span>
      {LIMIT_OPTIONS.map((opt) => (
        <button
          key={opt}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium border border-input bg-background h-7 px-2"
        >
          {opt}
        </button>
      ))}
      <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium bg-primary text-primary-foreground h-7 px-2">
        All
      </button>
    </div>
  );
}

interface SSRAppProps {
  logsCount: number;
}

// Shell with placeholder where logs will be streamed
function SSRApp({ logsCount }: SSRAppProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background p-4">
      {/* Header */}
      <div className="mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Log Viewer</h1>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3">
              Refresh
            </button>
            <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground h-9 px-3">
              Logout
            </button>
          </div>
        </div>
        {/* Filters - SSR shell, will be hydrated */}
        <div className="flex flex-wrap items-center gap-4">
          <SSRDateFilter />
          <SSRLevelFilter />
        </div>
        {/* Pagination rendered by client after hydration */}
      </div>

      {/* Log viewer - placeholder will be replaced with streamed content */}
      <div
        className="flex-1 overflow-auto bg-background border rounded"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: LOGS_PLACEHOLDER }}
      />

      {/* Pagination rendered by client after hydration */}
    </div>
  );
}

export interface SSROptions {
  password: string;
  cssPath: string;
  jsPath: string;
  limit?: number;
}

export interface SSRStreamContext {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

// Pre-render shell HTML at module load (cached)
let cachedShellHtml: string | null = null;
function getShellHtml(): { beforeLogs: string; afterLogs: string } {
  if (!cachedShellHtml) {
    cachedShellHtml = renderToString(<SSRApp logsCount={0} />);
  }
  const [beforeLogs, afterLogs] = cachedShellHtml.split(LOGS_PLACEHOLDER);
  return { beforeLogs, afterLogs };
}

export function createAppStream({ password, cssPath, jsPath }: SSROptions): {
  stream: ReadableStream<Uint8Array>;
  sendLogEntry: (entry: LogEntry) => void;
  sendEnd: (logsCount: number) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const t0 = performance.now();
  let logCount = 0;

  // Get cached shell HTML (instant, no renderToString)
  const { beforeLogs, afterLogs } = getShellHtml();

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      // Send HTML shell IMMEDIATELY on stream creation
      const paramsDoc = `<!--
  Log Viewer URL Parameters:
  - pwd: string (required) - API password
  - from: datetime-local - Start date filter (default: today 00:00)
  - to: datetime-local - End date filter (default: today 23:59)
  - level: string - Comma-separated log levels: debug,info,warn,error
  - limit: number - Entries per page (100, 500, 1000, 5000)
  - page: number - Page number (starts from 1, only with limit)

  Example: ?pwd=xxx&from=2025-12-10T00:00&to=2025-12-16T23:59&limit=100&page=2
-->`;
      const docStart = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="icon" type="image/svg+xml" href="/logo.svg"/><title>Log Viewer</title><link rel="stylesheet" href="${cssPath}"/></head>${paramsDoc}<!-- [SSR] shell sent: ${(performance.now() - t0).toFixed(1)}ms --><body><div id="root">`;
      // Loading indicator that will be replaced by first log entry
      const loadingIndicator = `<div id="ssr-loading" class="flex items-center justify-center p-8 text-muted-foreground"><span class="animate-pulse">Loading logs...</span></div>`;
      controller.enqueue(encoder.encode(docStart + beforeLogs + loadingIndicator));
    },
  });

  const sendLogEntry = (entry: LogEntry) => {
    logCount++;
    if (logCount === 1) {
      // Hide loading indicator, show timing
      controller.enqueue(encoder.encode(`<script>document.getElementById('ssr-loading')?.remove()</script><!-- [SSR] first log: ${(performance.now() - t0).toFixed(1)}ms -->`));
    }
    controller.enqueue(encoder.encode(logRowToHtml(entry)));
  };

  const sendEnd = (logsCount: number) => {
    const timing = `<!-- [SSR] stream end: ${(performance.now() - t0).toFixed(1)}ms, ${logsCount} entries -->`;
    // Password stored in data attribute for hydration
    const docEnd = `${timing}${afterLogs}</div><script>window.__SSR_PASSWORD__="${password}";window.__SSR_LOGS_COUNT__=${logsCount};</script><script type="module" src="${jsPath}" async></script></body></html>`;

    controller.enqueue(encoder.encode(docEnd));
    controller.close();
  };

  return { stream, sendLogEntry, sendEnd };
}

// Login page - no logs, just the form shell
export async function renderLoginPage(cssPath: string, jsPath: string): Promise<ReadableStream> {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="icon" type="image/svg+xml" href="/logo.svg"/><title>Log Viewer</title><link rel="stylesheet" href="${cssPath}"/></head><body><div id="root"></div><script type="module" src="${jsPath}" async></script></body></html>`;

  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(html));
      controller.close();
    },
  });
}
