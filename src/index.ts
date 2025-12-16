import { serve } from 'bun';
import { checkAuth } from './lib/auth';
import { formatLogForText, readLogs, streamLogs, tailLogs, type LogFilter } from './lib/logs';
import { renderInitialHtml } from './lib/ssr';

function parseFilter(url: URL): LogFilter {
  const filter: LogFilter = {};

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const level = url.searchParams.get('level');
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');

  if (from) filter.from = new Date(from);
  if (to) filter.to = new Date(to);
  if (level) filter.level = level.split(',');
  if (limit) filter.limit = parseInt(limit, 10);
  if (offset) filter.offset = parseInt(offset, 10);

  return filter;
}

const PORT = process.env.PORT || 3000;

// Read the built HTML template
const HTML_TEMPLATE_PATH = new URL('../dist/index.html', import.meta.url).pathname;

async function getHtmlTemplate(): Promise<string> {
  const file = Bun.file(HTML_TEMPLATE_PATH);
  if (await file.exists()) {
    return file.text();
  }
  // Fallback for development
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Log Viewer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/frontend.tsx"></script>
  </body>
</html>`;
}

const server = serve({
  port: Number(PORT),
  hostname: '0.0.0.0',
  routes: {
    // Main page - SSR with initial logs
    '/': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);

        const htmlTemplate = await getHtmlTemplate();

        // If no auth, serve without initial logs (login screen will show)
        if (authError) {
          return new Response(htmlTemplate, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        // SSR: render logs into HTML
        const filter = parseFilter(url);
        let ssrContent = '';

        try {
          const result = await readLogs(filter);
          const logsJson = JSON.stringify(result.logs);
          ssrContent = renderInitialHtml(result.logs, logsJson);
        } catch (err) {
          console.error('Error reading logs for SSR:', err);
          ssrContent = '<div class="p-4 text-center text-red-500">Error loading logs</div>';
        }

        // Insert SSR content into #root
        const html = htmlTemplate.replace(
          '<div id="root"></div>',
          `<div id="root">${ssrContent}</div>`
        );

        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    },

    // SSE stream for real-time updates
    '/api/logs/stream': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        if (authError) return authError;

        const filter = parseFilter(url);
        const encoder = new TextEncoder();

        let cleanup: (() => void) | null = null;

        const stream = new ReadableStream({
          start(controller) {
            cleanup = tailLogs(
              filter,
              (entry) => {
                const data = `data: ${JSON.stringify(entry)}\n\n`;
                controller.enqueue(encoder.encode(data));
              },
              () => {
                controller.close();
              }
            );
          },
          cancel() {
            cleanup?.();
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
            total: result.total,
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

          const logsText = result.logs.map(formatLogForText).join('\n');

          // Header with pagination info for AI agents
          const header = `# Log Viewer API
# Total: ${result.total} entries | Showing: ${result.logs.length} | HasMore: ${result.hasMore}
# Pagination: ?limit=N&offset=N (default limit=1000, offset=0)
# Filters: ?from=ISO_DATE&to=ISO_DATE&level=info,warn,error
# Example: ?limit=100&offset=100 for entries 100-199
# ---
`;

          return new Response(header + logsText, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return new Response(`Error: ${message}`, { status: 500 });
        }
      },
    },
  },

  // Serve static files from dist/
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Try to serve from dist/
    const distPath = new URL('../dist' + pathname, import.meta.url).pathname;
    const file = Bun.file(distPath);

    if (await file.exists()) {
      const ext = pathname.split('.').pop() || '';
      const contentType: Record<string, string> = {
        js: 'application/javascript',
        css: 'text/css',
        svg: 'image/svg+xml',
        png: 'image/png',
        ico: 'image/x-icon',
        map: 'application/json',
      };

      return new Response(file, {
        headers: {
          'Content-Type': contentType[ext] || 'application/octet-stream',
        },
      });
    }

    // 404
    return new Response('Not Found', { status: 404 });
  },

  development: process.env.NODE_ENV !== 'production' && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
