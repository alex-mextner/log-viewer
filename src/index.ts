import { serve } from 'bun';
import { checkAuth } from './lib/auth';
import { formatLogForText, readLogs, streamLogs, tailLogs, type LogFilter } from './lib/logs';

function parseFilter(url: URL): LogFilter {
  const filter: LogFilter = {};

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const level = url.searchParams.get('level');
  const limit = url.searchParams.get('limit');

  if (from) filter.from = new Date(from);
  if (to) filter.to = new Date(to);
  if (level) filter.level = level.split(',');
  if (limit) filter.limit = parseInt(limit, 10);

  return filter;
}

const PORT = process.env.PORT || 3000;

const HTML_HEAD = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Log Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-monospace, monospace;
      font-size: 12px;
      background: #0d1117;
      color: #c9d1d9;
      line-height: 1.4;
    }
    .log { padding: 2px 8px; border-bottom: 1px solid #21262d; white-space: pre-wrap; word-break: break-all; }
    .log:hover { background: #161b22; }
    .time { color: #8b949e; }
    .level-debug { color: #8b949e; }
    .level-info { color: #58a6ff; }
    .level-warn { color: #d29922; }
    .level-error { color: #f85149; }
    .module { color: #a5d6ff; }
    .msg { color: #c9d1d9; }
    #status {
      position: fixed;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      background: #238636;
      color: white;
      border-radius: 4px;
      font-size: 11px;
    }
    #status.error { background: #f85149; }
  </style>
</head>
<body>
<div id="status">Streaming...</div>
<div id="logs">`;

const HTML_TAIL = `</div>
<script>
const evtSource = new EventSource(window.location.href.replace(/\\/$/, '') + '/stream' + window.location.search);
const logs = document.getElementById('logs');
const status = document.getElementById('status');

evtSource.onmessage = (e) => {
  try {
    const entry = JSON.parse(e.data);
    const div = document.createElement('div');
    div.className = 'log';
    const time = entry.time.replace('T', ' ').substring(0, 19);
    div.innerHTML = '<span class="time">' + time + '</span> ' +
      '<span class="level-' + entry.level + '">[' + entry.level.toUpperCase() + ']</span> ' +
      '<span class="module">' + (entry.module || '-') + ':</span> ' +
      '<span class="msg">' + escapeHtml(entry.msg) + '</span>';
    logs.appendChild(div);
    window.scrollTo(0, document.body.scrollHeight);
  } catch {}
};

evtSource.onerror = () => {
  status.textContent = 'Disconnected';
  status.className = 'error';
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>
</body>
</html>`;

function formatLogHtml(entry: { level: string; time: string; module?: string; msg: string }): string {
  const time = entry.time.replace('T', ' ').substring(0, 19);
  const msg = entry.msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="log"><span class="time">${time}</span> <span class="level-${entry.level}">[${entry.level.toUpperCase()}]</span> <span class="module">${entry.module || '-'}:</span> <span class="msg">${msg}</span></div>\n`;
}

const server = serve({
  port: Number(PORT),
  hostname: '0.0.0.0',
  routes: {
    // Main page - streaming HTML with logs
    '/': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        if (authError) return authError;

        const filter = parseFilter(url);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            // Send HTML head
            controller.enqueue(encoder.encode(HTML_HEAD));

            // Stream existing logs
            try {
              await streamLogs(filter, (entry) => {
                controller.enqueue(encoder.encode(formatLogHtml(entry)));
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Error';
              controller.enqueue(encoder.encode(`<div class="log level-error">Error: ${msg}</div>`));
            }

            // Send HTML tail (includes SSE script)
            controller.enqueue(encoder.encode(HTML_TAIL));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Transfer-Encoding': 'chunked',
          },
        });
      },
    },

    // SSE stream for real-time updates
    '/stream': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        if (authError) return authError;

        const filter = parseFilter(url);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          start(controller) {
            const cleanup = tailLogs(
              filter,
              (entry) => {
                const data = `data: ${JSON.stringify(entry)}\n\n`;
                controller.enqueue(encoder.encode(data));
              },
              () => {
                controller.close();
              }
            );

            (controller as unknown as { cleanup: () => void }).cleanup = cleanup;
          },
          cancel(controller) {
            const c = controller as unknown as { cleanup?: () => void };
            c.cleanup?.();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
    },

    // JSON API
    '/api/logs': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        if (authError) return authError;

        try {
          const filter = parseFilter(url);
          const result = await readLogs(filter);

          return Response.json({
            logs: result.logs,
            count: result.logs.length,
            hasMore: result.hasMore,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // Plain text for AI agents
    '/api/logs/raw': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        if (authError) return authError;

        try {
          const filter = parseFilter(url);
          const result = await readLogs(filter);

          const text = result.logs.map(formatLogForText).join('\n');

          return new Response(text, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return new Response(`Error: ${message}`, { status: 500 });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== 'production' && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
