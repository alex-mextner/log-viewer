import type { LogEntry } from './logs';

const LEVEL_COLORS: Record<string, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(time: string): string {
  try {
    const date = new Date(time);
    return date.toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return time;
  }
}

function renderLogRow(entry: LogEntry): string {
  const levelColor = LEVEL_COLORS[entry.level] || 'text-gray-400';
  const time = escapeHtml(formatTime(entry.time));
  const level = escapeHtml(entry.level);
  const module = escapeHtml(entry.module || '-');
  const msg = escapeHtml(entry.msg);

  return `<div class="flex gap-2 px-2 py-0.5 hover:bg-accent cursor-pointer text-sm font-mono" data-log-idx>
    <span class="text-muted-foreground shrink-0">${time}</span>
    <span class="shrink-0 w-12 uppercase ${levelColor}">${level}</span>
    <span class="text-muted-foreground shrink-0 w-24 truncate">${module}</span>
    <span class="truncate">${msg}</span>
  </div>`;
}

export function renderLogsToHtml(logs: LogEntry[]): string {
  if (logs.length === 0) {
    return `<div class="p-4 text-center text-muted-foreground">No logs found</div>`;
  }

  return logs.map(renderLogRow).join('\n');
}

export function renderInitialHtml(logs: LogEntry[], logsJson: string): string {
  const logsHtml = renderLogsToHtml(logs);

  return `<div class="min-h-screen flex flex-col bg-background p-4">
  <div class="mb-4 space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">Log Viewer</h1>
      <div class="flex items-center gap-2">
        <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3">Refresh</button>
        <button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 px-3">Logout</button>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-4" id="ssr-filters">
      <!-- Filters will be hydrated by React -->
    </div>
  </div>
  <div class="flex-1 overflow-auto bg-background border rounded" id="ssr-logs">
    ${logsHtml}
  </div>
  <div class="flex items-center justify-between text-xs text-muted-foreground px-2 py-1">
    <span>${logs.length} entries</span>
    <div class="flex items-center gap-2">
      <span>Loading...</span>
    </div>
  </div>
</div>
<script>window.__INITIAL_LOGS__=${logsJson};</script>`;
}
