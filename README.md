# soksak-plugin-runbook

A soksak plugin for storing and running reusable tasks (runbooks). Tasks compose parameters, environment variables,
secrets, and other task outputs as References. Linking resolves safely through pure interpretation, a dependency
graph, and cycle detection. Shown as a right sidebar tab.

## Execution Types (5)

| Type | Behavior |
|---|---|
| `terminal` | Sends command + Enter to the focused terminal pane via core `term.exec`. Rejected when secrets are present (risk of ps exposure). |
| `script` | Runs under a shell (`/bin/sh -c`) — captures stdout/stderr and exitCode. |
| `background` | Same path as script (intended for recurring runs). |
| `api` | HTTP request (method/url/headers/query/body) → captures status and body. Uses core `net.http.request` (reqwest + rustls). |
| `schedule` | Arms the core scheduler — fires an action (shell) at the due time, with repeat (daily/weekly/monthly), interval, and reminders. |

`command.run` only arms schedule tasks; all other types execute immediately. When the core timer fires
`schedule.fire` at the due time, it runs the action and re-arms the next occurrence (repeating). Persistence
is owned by the plugin — re-armed on activate.

## Reference Resolution Engine (`src/refs/`, pure core)

Redesign of CommandBar's stored-token system (string substitution with cycle detection at 0 → no infinite
recursion) as a pure, cycle-detecting structure. Zero I/O.

- `parse(template)` — decomposes a template into nodes and References. Tokens:
  - `{name}` / `{name:a|b}` — parameter (optional list)
  - `{{var}}` — environment variable
  - `` `secret@key` `` — secret (handle marker only — no plaintext held)
  - `` `command@id|jsonPath` `` — another task's output (chain — cycle target)
  - `` `clipboard@id` `` / `` `var@id|jsonPath` `` — clipboard or named variable
- `dependencyGraph` / `topoSort` / `detectCycle` — command-chain dependency graph, execution order, and cycle
  rejection (3-color DFS).
- `resolve(parsed, context)` — substitutes using context. Unresolved references propagate explicitly as
  `LinkError` (unsubstituted tokens do not leak into shell/HTTP).
- Token regexes live in one place: `src/refs/patterns.ts` (no duplication). JSONPath extraction is a single util.

Linking operates across api fields (url/headers/body) — one task's output feeds another task's URL or headers.

## Secrets (no plaintext exposure)

Secret references flow as handle markers only during resolution — never as plaintext. Plaintext injection happens
**only at the Rust boundary**:
- script/background — injected into child process env (`$SOKSAK_SECRET_N`).
- api — core resolves placeholder in url/headers/body from the vault and substitutes in-place (secretSubst).

No plaintext appears in the command template, history, lastOutput, or response. If a secret is missing from the
vault or the vault is locked, execution is rejected before it starts with `SECRET_PENDING`
(`secret.set` / `secret.unlock` guidance provided). Secrets themselves are managed by core `app.secrets`
(encrypted vault) — this plugin holds references only.

## Inline Badge Input UI

Command templates are edited in a `contenteditable` editor that renders tokens as non-editable badges (atomic
glyphs) — caret, delete, and arrow keys jump over a badge as a whole. Token type is indicated by badge color
(secret=amber, command=blue, param=purple, env=teal, var=cyan, clipboard=orange). An autocomplete dropdown
(ARIA combobox) fills in tokens. Secrets display label only (no plaintext held). Token↔badge serialization and
trigger detection live in the pure `src/ui/tokens` module (single parser reuse).

## Data

Core `app.data` only (SQLite, namespaced to this plugin) — no raw SQL. Collections: `commands` / `groups` /
`history`, CJK full-text search (FTS5 trigram). Enums use stable English keys; soft-delete is a boolean
`deleted`. Supports groups, favorites, trash, history, and import/export (JSONL).

## Commands (all features exposed — CLI/MCP/view-agnostic)

`command.add/get/update/delete/restore/duplicate/list/search/set-group/favorite/run`, `schedule.fire`,
`group.*`, `history.*`, `import`/`export`, engine validation via `ref.parse`/`ref.resolve`, editor
`editor.tokens`/`editor.serialize`. Examples:

```
sok plugin.soksak-plugin-runbook.command.add '{"label":"deploy","command":"make deploy {env:dev|prod}","executionType":"script"}'
sok plugin.soksak-plugin-runbook.command.run '{"commandId":"<id>","inputs":{"env":"prod"}}'
```

## Build / Test

```
npm install
npm run build   # esbuild: src/index.ts → main.js (single ESM)
npm test        # vitest run (refs/exec/ui unit tests)
# Socket E2E (requires core dev running):
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook.mjs        # CRUD
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-exec.mjs   # linking, shell, secret gate/injection
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-api.mjs    # HTTP (local server)
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-schedule.mjs  # timer fire and re-arm
SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/runbook-ui.mjs     # badge editor (ui.tree/measure)
```

`main.js` is a build artifact (bundle) and is committed.

## Out of Scope (this iteration)

- api multipart (file upload) — current body types: none/json/form.
- Deeplink click → command (desktop notification per-click action unsupported by platform — core
  `soksak://run?cmd=` routing works).
- Project-scoped schedule re-arm — activate re-arm is global scope.

Permissions: `data` · `commands` (+`inject`) · `ui` · `process` · `network` · `notify` · `programs` · `clipboard:read` · `secrets`.
