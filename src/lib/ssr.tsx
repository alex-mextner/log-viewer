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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
function _SSRPagination({ total }: { total: number }) {
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
  // biome-ignore lint: Bun direct stream controller type
  let controller: any = null;
  const t0 = performance.now();
  let logCount = 0;
  let shellSent = false;

  // Get cached shell HTML (instant, no renderToString)
  const { beforeLogs, afterLogs } = getShellHtml();

  // Build shell HTML
  const paramsDoc = `<!--
  FOR AI AGENTS:
  DO NOT use /api/logs (JSON) - it may fail with large responses.
  USE /api/logs/raw (plain text) - optimized for AI consumption.

  API Endpoints:
  - /api/logs/raw?pwd=XXX - plain text logs (RECOMMENDED for AI)
  - /api/logs/stream?pwd=XXX - SSE real-time stream
  - /api/logs?pwd=XXX - JSON (NOT recommended, may fail)

  Query Parameters:
  - pwd: string (required) - API password
  - from: ISO datetime - Start date (e.g., 2025-12-15T00:00)
  - to: ISO datetime - End date (e.g., 2025-12-15T23:59)
  - level: string - Comma-separated: debug,info,warn,error
  - module: string - Comma-separated module names (e.g., scheduler,telegram)
  - limit: number - Max entries (100, 500, 1000, 5000)
  - offset: number - Skip N entries for pagination

  Example: /api/logs/raw?pwd=XXX&from=2025-12-15T00:00&module=scheduler&limit=100
-->`;
  const docStart = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="icon" type="image/svg+xml" href="/logo.svg"/><title>Log Viewer</title><link rel="stylesheet" href="${cssPath}"/></head>${paramsDoc}<!-- [SSR] shell sent: ${(performance.now() - t0).toFixed(1)}ms --><body><div id="root">`;
  const loadingIndicator = `<div id="ssr-loading" class="flex items-center justify-center p-8 text-muted-foreground"><span class="animate-pulse">Loading logs...</span></div>`;
  const shellHtml = docStart + beforeLogs + loadingIndicator;

  // Use Bun's direct stream with explicit flush() for immediate delivery
  // See: https://github.com/oven-sh/bun/discussions/13923
  const stream = new ReadableStream({
    type: 'direct' as const,
    pull(c: { write: (data: Uint8Array) => void; flush: () => void; close: () => void }) {
      controller = c;
      // Send shell immediately on first pull and flush
      if (!shellSent) {
        shellSent = true;
        controller.write(encoder.encode(shellHtml));
        controller.flush();
      }
      // Return never-resolving promise to keep stream open for sendLogEntry/sendEnd
      return new Promise(() => {});
    },
  } as unknown as UnderlyingDefaultSource<Uint8Array>);

  const sendLogEntry = (entry: LogEntry) => {
    if (!controller) return;
    logCount++;
    if (logCount === 1) {
      controller.write(
        encoder.encode(
          `<script>document.getElementById('ssr-loading')?.remove()</script><!-- [SSR] first log: ${(performance.now() - t0).toFixed(1)}ms -->`
        )
      );
      controller.flush();
    }
    controller.write(encoder.encode(logRowToHtml(entry)));
    controller.flush();
  };

  const sendEnd = (logsCount: number) => {
    if (!controller) return;
    const timing = `<!-- [SSR] stream end: ${(performance.now() - t0).toFixed(1)}ms, ${logsCount} entries -->`;
    const docEnd = `${timing}${afterLogs}</div><script>window.__SSR_PASSWORD__="${password}";window.__SSR_LOGS_COUNT__=${logsCount};</script><script type="module" src="${jsPath}" async></script></body></html>`;

    controller.write(encoder.encode(docEnd));
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
