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
  password: string;
  cssPath: string;
  jsPath: string;
}

export interface SSRStreamContext {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

export function createAppStream({ password, cssPath, jsPath }: SSROptions): {
  stream: ReadableStream<Uint8Array>;
  sendStart: () => void;
  sendLogEntry: (entry: LogEntry) => void;
  sendEnd: (logsCount: number) => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const t0 = performance.now();
  let logCount = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const sendStart = () => {
    const tRender = performance.now();
    // Render shell with placeholder (logsCount will be updated at the end via JS)
    const shellHtml = renderToString(<SSRApp logsCount={0} />);
    const renderTime = performance.now() - tRender;
    const [beforeLogs] = shellHtml.split(LOGS_PLACEHOLDER);

    const timing = `<!-- [SSR] stream created: ${(performance.now() - t0).toFixed(1)}ms, renderToString: ${renderTime.toFixed(1)}ms -->`;
    // Critical inline CSS for instant render, full CSS loads async
    const criticalCss = `<style>
      :root{--background:0 0% 100%;--foreground:240 10% 3.9%;--muted-foreground:240 3.8% 46.1%;--accent:240 4.8% 95.9%;--border:240 5.9% 90%}
      .dark{--background:240 10% 3.9%;--foreground:0 0% 98%;--muted-foreground:240 5% 64.9%;--accent:240 3.7% 15.9%;--border:240 3.7% 15.9%}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;background:hsl(var(--background));color:hsl(var(--foreground))}
      .min-h-screen{min-height:100vh}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}
      .p-4{padding:1rem}.mb-4{margin-bottom:1rem}.gap-2{gap:.5rem}.gap-4{gap:1rem}
      .text-xl{font-size:1.25rem}.font-semibold{font-weight:600}.font-mono{font-family:ui-monospace,monospace}
      .text-sm{font-size:.875rem}.text-xs{font-size:.75rem}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .overflow-auto{overflow:auto}.border{border:1px solid hsl(var(--border))}.rounded{border-radius:.375rem}
      .bg-background{background:hsl(var(--background))}.text-muted-foreground{color:hsl(var(--muted-foreground))}
      .shrink-0{flex-shrink:0}.items-center{align-items:center}.justify-between{justify-content:space-between}
      .px-2{padding-left:.5rem;padding-right:.5rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-0\\.5{padding-top:.125rem;padding-bottom:.125rem}
      .hover\\:bg-accent:hover{background:hsl(var(--accent))}.cursor-pointer{cursor:pointer}
      .w-12{width:3rem}.w-24{width:6rem}.uppercase{text-transform:uppercase}
      .text-gray-400{color:#9ca3af}.text-blue-400{color:#60a5fa}.text-yellow-400{color:#facc15}.text-red-400{color:#f87171}
    </style>`;
    const docStart = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="icon" type="image/svg+xml" href="/logo.svg"/><title>Log Viewer</title>${criticalCss}<link rel="stylesheet" href="${cssPath}" media="print" onload="this.media='all'"/><noscript><link rel="stylesheet" href="${cssPath}"/></noscript></head>${timing}<body><div id="root">`;

    controller.enqueue(encoder.encode(docStart + beforeLogs));
  };

  const sendLogEntry = (entry: LogEntry) => {
    logCount++;
    if (logCount === 1) {
      controller.enqueue(encoder.encode(`<!-- [SSR] first log: ${(performance.now() - t0).toFixed(1)}ms -->`));
    }
    controller.enqueue(encoder.encode(logRowToHtml(entry)));
  };

  const sendEnd = (logsCount: number) => {
    const shellHtml = renderToString(<SSRApp logsCount={0} />);
    const [, afterLogs] = shellHtml.split(LOGS_PLACEHOLDER);

    const timing = `<!-- [SSR] stream end: ${(performance.now() - t0).toFixed(1)}ms, ${logsCount} entries -->`;
    // Password stored in data attribute for hydration
    const docEnd = `${timing}${afterLogs}</div><script>window.__SSR_PASSWORD__="${password}";window.__SSR_LOGS_COUNT__=${logsCount};</script><script type="module" src="${jsPath}" async></script></body></html>`;

    controller.enqueue(encoder.encode(docEnd));
    controller.close();
  };

  return { stream, sendStart, sendLogEntry, sendEnd };
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
