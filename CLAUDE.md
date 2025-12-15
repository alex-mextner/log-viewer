---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

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

## Bun APIs Used

- `Bun.serve()` with routes for API
- `Bun.file()` for log reading
- HTML imports for frontend bundling
- SSE via ReadableStream

## Deploy

PM2 config in `ecosystem.config.js`. GitHub Action in `.github/workflows/deploy.yml`.
