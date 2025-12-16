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

// Pure HTML string for a log row (for streaming)
function logRowToHtml(entry: LogEntry): string {
  const levelColor = LEVEL_COLORS[entry.level] || 'text-gray-400';
  const time = formatTime(entry.time);
  const module = entry.module || '-';
  // Escape HTML
  const msg = (entry.msg || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<div class="flex gap-2 px-2 py-0.5 hover:bg-accent cursor-pointer text-sm font-mono"><span class="text-muted-foreground shrink-0">${time}</span><span class="shrink-0 w-12 uppercase ${levelColor}">${entry.level}</span><span class="text-muted-foreground shrink-0 w-24 truncate">${module}</span><span class="truncate">${msg}</span></div>`;
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
      </div>

      {/* Log viewer - placeholder will be replaced with streamed content */}
      <div
        className="flex-1 overflow-auto bg-background border rounded"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: LOGS_PLACEHOLDER }}
      />

      {/* Status bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-2 py-1">
        <span>{logsCount} entries</span>
        <span>SSR</span>
      </div>
    </div>
  );
}

export interface SSROptions {
  logs: LogEntry[];
  password: string;
  cssPath: string;
  jsPath: string;
}

export async function renderAppToStream({ logs, password, cssPath, jsPath }: SSROptions): Promise<ReadableStream> {
  const initialData = {
    initialLogs: logs,
    initialPassword: password,
  };

  // Render shell with placeholder
  const shellHtml = renderToString(<SSRApp logsCount={logs.length} />);

  // Split by placeholder
  const [beforeLogs, afterLogs] = shellHtml.split(LOGS_PLACEHOLDER);

  // Build document parts
  const docStart = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="icon" type="image/svg+xml" href="/logo.svg"/><title>Log Viewer</title><link rel="stylesheet" href="${cssPath}"/></head><body><div id="root">`;

  const docEnd = `</div><script>window.__INITIAL_DATA__=${JSON.stringify(initialData)};</script><script type="module" src="${jsPath}" async></script></body></html>`;

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      // 1. Send document start + shell before logs
      controller.enqueue(encoder.encode(docStart + beforeLogs));

      // 2. Stream logs one by one
      for (const entry of logs) {
        controller.enqueue(encoder.encode(logRowToHtml(entry)));
      }

      // 3. Send shell after logs + document end
      controller.enqueue(encoder.encode(afterLogs + docEnd));

      controller.close();
    },
  });
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
