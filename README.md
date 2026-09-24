# Helm

Personal live task board, readable by you and by AI agents.

## Run locally

```bash
pnpm install
cp .env.example .env        # set HELM_OWNER_PASSWORD and HELM_SESSION_SECRET
pnpm --filter @helm/server seed   # optional sample data
pnpm dev                    # server on :8787, web on :5173
```

Open http://localhost:5173 and sign in with `HELM_OWNER_PASSWORD`.

## Use it as an app

```bash
pnpm build                  # builds the PWA into apps/web/dist
pnpm start                  # server on :8787 serves the API and the app (HELM_WEB_DIST)
```

Open http://localhost:8787 and install it from the browser (the install icon in the address
bar in Chrome or Edge). The installed app:

- opens without a connection, showing the last board it saw (marked Offline); changes need
  the server and say so if they can't be saved
- updates itself when a new build is served, checking hourly while it stays open
- keeps the board, projects and sign-in state in the browser's local storage on that device,
  cleared when the session ends

Installing needs a secure origin: `localhost` works; for a phone, serve it over HTTPS
(for example `tailscale serve`) and set `HELM_COOKIE_SECURE=true`.

## Voice input

Press the microphone (or V), say the task, press Done. Helm transcribes it, fills in the
title, project, priority, estimate and subtasks, and opens the task for you to check. Nothing is
saved until you press Add task. Several separate to-dos in one recording become one draft each.

- With `OPENAI_API_KEY` set, audio goes to OpenAI for transcription (`HELM_STT_MODEL`) and the
  text to `HELM_LLM_MODEL` for the fields.
- Without a key, the browser's own speech recognition is used where it exists (Chrome sends the
  audio to Google; Safari works on the device), and what you said becomes the title as is.
- The microphone only works on a secure origin: `localhost`, or HTTPS on a phone.

Providers sit behind small interfaces in `packages/providers` (`LlmProvider`, `SttProvider`).
Choose them with `HELM_LLM_PROVIDER` and `HELM_STT_PROVIDER` (`openai` or `none`);
`OPENAI_BASE_URL` points the OpenAI adapter at any compatible API.

`POST /api/v1/voice/parse` takes audio (`Content-Type: audio/webm`, `audio/mp4`, ...) or JSON
`{"text": "..."}` and returns suggestions without saving them. Read-only tokens can't use it.

## Assistant

Open the assistant with the compass button (or A). It needs `OPENAI_API_KEY` (or another
`HELM_LLM_PROVIDER`). Your open tasks and the last week's done work are sent to the model with
each request.

- **Suggest order**: a working order for all open tasks, a suggested priority and a one-line
  reason for each. Change priorities or move rows, then apply. Undo puts everything back.
- **Chat**: ask about the board or ask for changes. The assistant only proposes changes (add,
  edit, start, pause, finish, reopen; never delete); tick the ones you want and apply them.

Applied changes are recorded as `ai:assistant`. Endpoints (owner only): `POST
/api/v1/assistant/prioritize`, `POST /api/v1/assistant/chat` (streams NDJSON) and `POST
/api/v1/assistant/apply`. `POST /api/v1/tasks/arrange` reorders tasks for any client.

## Connect AI assistants

In Helm, open Settings (the cog) and create a token for each assistant or script. Choose read
only or read and change, all projects or only some, and an optional expiry. The token is shown
once; Helm keeps only its SHA-256. Revoking takes effect immediately, including open streams.

**MCP** (Streamable HTTP) at `/mcp`, bearer token only:

```bash
claude mcp add --transport http helm http://localhost:8787/mcp --header "Authorization: Bearer helm_..."
```

Tools: `get_focus`, `list_tasks`, `get_task`, `list_projects`, `list_done`, and with read and
change access `create_task`, `update_task`, `start_task`, `pause_task`, `complete_task`,
`reopen_task`, `move_task`. Read-only tokens only see the read tools. There is no delete tool.

**REST**: every `/api/v1` endpoint accepts `Authorization: Bearer helm_...`, with the same
scope rules. Tasks created with a token are marked `ai:<token name>`.

Assistants that only accept OAuth connectors (such as Claude or ChatGPT on the web) can't use a
plain token yet.

## Layout

```
apps/server         Hono API, SSE stream, services (all rules live here), modules
apps/web            React PWA
packages/shared     zod schemas, types, pure logic (tree, focus)
packages/db         Drizzle schema + SQLite migrations
packages/providers  LLM and speech-to-text adapters (OpenAI)
```

Every write goes through `apps/server/src/core/services`. REST, MCP and AI modules call the
same services with a `Principal`, so scope checks and events happen in one place.

## Scripts

- `pnpm test`: all tests
- `pnpm typecheck`: all packages
- `pnpm db:generate`: new migration after editing `packages/db/src/schema.ts`
- `pnpm --filter @helm/web icons`: regenerate app icons after editing `apps/web/scripts/icons.mjs`

## Config

See `.env.example`. Task rules are config, not code:
`HELM_IN_PROGRESS_LIMIT` (default 1, 0 = unlimited) and `HELM_MAX_SUBTASK_DEPTH` (default 1).
