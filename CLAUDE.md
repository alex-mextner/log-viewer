# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Project Structure

```
src/
├── index.ts              # Bun server with API routes
├── App.tsx               # Main React component
├── lib/
│   ├── auth.ts           # Password check from ?pwd=
│   └── logs.ts           # NDJSON parser, filters, tail
├── hooks/
│   ├── useLogs.ts        # SSE subscription + fetch
│   └── useUrlParams.ts   # URL query sync
└── components/
    ├── DateFilter.tsx    # Date range filter
    ├── LevelFilter.tsx   # Log level filter
    └── LogViewer.tsx     # Log display with auto-scroll
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/logs?pwd=...` | JSON logs with filters |
| `GET /api/logs/raw?pwd=...` | Plain text for AI agents |
| `GET /api/logs/stream?pwd=...` | SSE real-time stream |

Query params: `pwd`, `from`, `to`, `level`, `limit`

## Commands

```bash
bun dev          # Start dev server with HMR
bun run build    # Build for production
bun start        # Run production server
bun test         # Run tests
bun run lint     # Check with Biome
bun run lint:fix # Auto-fix lint issues
```

## Config

Environment variables (auto-loaded from .env):
- `LOG_FILE_PATH` — path to NDJSON log file
- `LOG_PASSWORD` — API access password

## Log Format

NDJSON with fields: `level`, `time`, `module`, `msg`, plus any extras.

```json
{"level":"info","time":"2025-12-12T08:00:00Z","module":"scheduler","msg":"Started"}
```

## Architecture

### Server-Side Rendering (SSR)

The app uses streaming SSR for instant perceived load:

1. **Server** (`src/index.ts`) handles routes via `Bun.serve()` with declarative routes
2. **SSR layer** (`src/lib/ssr.tsx`) streams HTML shell immediately, then log entries one by one
3. **Hydration**: Client React app picks up SSR HTML via `data-log-item` attributes
4. **Real-time**: After historical logs, SSE stream continues for live updates

Flow: Request → Auth check → Stream HTML shell → Stream log rows → Close with hydration script → Client hydrates

### Log Processing

`src/lib/logs.ts` handles large log files efficiently:
- **Binary search** (`findOffsetForDate`) to skip to relevant date range in multi-MB files
- **Offset caching** for repeated queries with similar date ranges
- **Streaming read** with chunked parsing to avoid loading entire file into memory
- **File watching** (`tailLogs`) for real-time updates via `fs.watch`

### Client State

- `useLogs` hook manages SSE connection lifecycle
- SSR logs are passed via `window.__SSR_PASSWORD__` and `data-log-item` attributes
- Filter state synced to URL params for shareable links

## Deploy

PM2 config in `ecosystem.config.js`. GitHub Action in `.github/workflows/deploy.yml`.
