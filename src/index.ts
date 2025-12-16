import { serve } from 'bun';
import { readdir } from 'node:fs/promises';
import { checkAuth } from './lib/auth';
import { formatLogForText, readLogs, streamLogs, tailLogs, type LogFilter } from './lib/logs';
import { createAppStream, renderLoginPage } from './lib/ssr';

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
const DIST_PATH = new URL('../dist', import.meta.url).pathname;

// Find bundled assets (they have hashed names)
async function findAssets(): Promise<{ cssPath: string; jsPath: string }> {
  const files = await readdir(DIST_PATH);
  const cssFile = files.find((f) => f.endsWith('.css')) || 'styles.css';
  const jsFile = files.find((f) => f.endsWith('.js') && !f.endsWith('.map')) || 'main.js';
  return {
    cssPath: '/' + cssFile,
    jsPath: '/' + jsFile,
  };
}

// Cache assets paths
let assetsCache: { cssPath: string; jsPath: string } | null = null;
async function getAssets() {
  if (!assetsCache) {
    assetsCache = await findAssets();
  }
  return assetsCache;
}

const server = serve({
  port: Number(PORT),
  hostname: '0.0.0.0',
  routes: {
    // Main page - SSR with streaming
    '/': {
      async GET(req) {
        const url = new URL(req.url);
        const authError = checkAuth(url);
        const { cssPath, jsPath } = await getAssets();
        const password = url.searchParams.get('pwd') || '';

        // If no auth, serve login page
        if (authError) {
          const stream = await renderLoginPage(cssPath, jsPath);
          return new Response(stream, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }

        // SSR: stream logs as HTML line by line
        const filter = parseFilter(url);

        const { stream, sendStart, sendLogEntry, sendEnd } = createAppStream({
          password,
          cssPath,
          jsPath,
        });

        // Start streaming in background
        (async () => {
          try {
            sendStart();

            let count = 0;
            await streamLogs(filter, (entry) => {
              sendLogEntry(entry);
              count++;
            });

            sendEnd(count);
          } catch (err) {
            console.error('Error streaming logs:', err);
            sendEnd(0);
          }
        })();

        return new Response(stream, {
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
    const filePath = DIST_PATH + pathname;
    const file = Bun.file(filePath);

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
          'Cache-Control': 'public, max-age=31536000, immutable',
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
