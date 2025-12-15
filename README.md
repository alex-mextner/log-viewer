# Log Viewer

Real-time NDJSON log viewer with date filtering. Designed for AI agent consumption.

## Features

- Real-time log streaming via SSE
- Filter by date range and log level
- Plain text endpoint for AI agents
- Password protection via query param
- URL state sync (shareable filter links)

## Quick Start

```bash
# Install
bun install

# Configure
cp .env.example .env
# Edit .env: set LOG_FILE_PATH and LOG_PASSWORD

# Run
bun dev
```

Open http://localhost:3000

## API

All endpoints require `?pwd=<password>` parameter.

### GET /api/logs

JSON response with filtered logs.

```bash
curl "http://localhost:3000/api/logs?pwd=secret&level=error,warn&limit=100"
```

Query params:
- `pwd` (required) — password
- `from` — ISO date start
- `to` — ISO date end
- `level` — comma-separated: debug,info,warn,error
- `limit` — max entries (default 1000)

Response:
```json
{
  "logs": [{"level":"info","time":"...","module":"...","msg":"..."}],
  "count": 100,
  "hasMore": true
}
```

### GET /api/logs/raw

Plain text for AI agents. Same query params as `/api/logs`.

```bash
curl "http://localhost:3000/api/logs/raw?pwd=secret&level=error"
```

Output:
```
2025-12-12 08:00:00.032 [info] scheduler: Morning post
2025-12-12 08:00:17.565 [warn] scheduler: Problem (userId=777000)
```

### GET /api/logs/stream

SSE endpoint for real-time tail.

```bash
curl "http://localhost:3000/api/logs/stream?pwd=secret&level=info,warn,error"
```

## Log Format

Expects NDJSON (one JSON per line):

```json
{"level":"info","time":"2025-12-12T08:00:00.032Z","module":"scheduler","msg":"Message"}
```

Compatible with pino, bunyan, winston JSON format.

## Deploy

### PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

### GitHub Actions

Add `SSH_PRIVATE_KEY` secret to repository. Push to `main` triggers deploy.

## Environment

| Variable | Description |
|----------|-------------|
| `LOG_FILE_PATH` | Path to NDJSON log file |
| `LOG_PASSWORD` | API access password |
| `PORT` | Server port (default 3000) |
