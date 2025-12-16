import { serve } from 'bun';
import { checkAuth } from './lib/auth';
import { formatLogForText, readLogs, streamLogs, tailLogs, type LogFilter } from './lib/logs';

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

        // Stream initial logs into HTML
        const filter = parseFilter(url);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            // Insert initial logs script before </head>
            const scriptStart = '<script>window.__INITIAL_LOGS__=[';
            const headEnd = '</head>';
            const parts = htmlTemplate.split(headEnd);

            if (parts.length === 2) {
              controller.enqueue(encoder.encode(parts[0] + scriptStart));

              // Stream logs as JSON array elements
              let first = true;
              try {
                await streamLogs(filter, (entry) => {
                  const prefix = first ? '' : ',';
                  first = false;
                  controller.enqueue(encoder.encode(prefix + JSON.stringify(entry)));
                });
              } catch (err) {
                // Log error but continue
                console.error('Error streaming logs:', err);
              }

              controller.enqueue(encoder.encode('];</script>' + headEnd + parts[1]));
            } else {
              // Fallback - just serve template
              controller.enqueue(encoder.encode(htmlTemplate));
            }

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
