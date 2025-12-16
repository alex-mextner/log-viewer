import { Suspense } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import type { LogEntry } from './logs';

// Lightweight SSR components - no hooks, no client-side code

interface LogRowProps {
  entry: LogEntry;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

function formatTime(time: string): string {
  try {
    const date = new Date(time);
    return date.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return time;
  }
}

function LogRow({ entry }: LogRowProps) {
  const levelColor = LEVEL_COLORS[entry.level] || 'text-gray-400';
  return (
    <div className="flex gap-2 px-2 py-0.5 hover:bg-accent cursor-pointer text-sm font-mono">
      <span className="text-muted-foreground shrink-0">{formatTime(entry.time)}</span>
      <span className={`shrink-0 w-12 uppercase ${levelColor}`}>{entry.level}</span>
      <span className="text-muted-foreground shrink-0 w-24 truncate">{entry.module || '-'}</span>
      <span className="truncate">{entry.msg}</span>
    </div>
  );
}

function LogsList({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No logs found</div>;
  }

  return (
    <>
      {logs.map((entry, i) => (
        <LogRow key={`${entry.time}-${i}`} entry={entry} />
      ))}
    </>
  );
}

function LogsLoading() {
  return <div className="p-4 text-center text-muted-foreground">Loading logs...</div>;
}

interface SSRAppProps {
  logs: LogEntry[];
  password: string;
  logsCount: number;
}

function SSRApp({ logs, logsCount }: SSRAppProps) {
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
        {/* Filters placeholder - will be hydrated */}
        <div className="flex flex-wrap items-center gap-4" id="ssr-filters" />
      </div>

      {/* Log viewer with Suspense for streaming */}
      <div className="flex-1 overflow-auto bg-background border rounded">
        <Suspense fallback={<LogsLoading />}>
          <LogsList logs={logs} />
        </Suspense>
      </div>

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

  const stream = await renderToReadableStream(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <title>Log Viewer</title>
        <link rel="stylesheet" href={cssPath} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__INITIAL_DATA__=${JSON.stringify(initialData)};`,
          }}
        />
      </head>
      <body>
        <div id="root">
          <SSRApp logs={logs} password={password} logsCount={logs.length} />
        </div>
        <script type="module" src={jsPath} async />
      </body>
    </html>,
    {
      onError(error) {
        console.error('SSR Error:', error);
      },
    }
  );

  return stream;
}

// Login page - no logs, just the form shell
export async function renderLoginPage(cssPath: string, jsPath: string): Promise<ReadableStream> {
  const stream = await renderToReadableStream(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/svg+xml" href="/logo.svg" />
        <title>Log Viewer</title>
        <link rel="stylesheet" href={cssPath} />
      </head>
      <body>
        <div id="root">
          {/* React will render login form */}
        </div>
        <script type="module" src={jsPath} async />
      </body>
    </html>
  );

  return stream;
}
