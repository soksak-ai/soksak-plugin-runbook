---
name: soksak-runbook
description: Use when saving, organizing, running, or scheduling reusable commands inside soksak — drive the runbook plugin entirely by CLI/MCP commands (`sok plugin.soksak-plugin-runbook.*`) to create command entries (shell/HTTP/etc), link them with `{{references}}`, group and favorite them, run them, schedule them, and read execution history. Headless: works without opening the GUI. 런북, 저장된 명령/작업 러너, 실행, 스케줄, 반복 작업, 참조 링킹도 여기.
---

# soksak runbook — saved, linkable, schedulable commands

A runbook holds **command entries**: a labeled, reusable action (a shell command, an HTTP request, etc — `executionType`) you can run on demand or on a schedule. Entries live in a `scope` (global or per-project), can be grouped and favorited, and can **reference each other** via `{{...}}` templates resolved at run time. Every entry's run is recorded in history. Drive it all by command — a view, if open, only renders.

## Discover first

Names/params evolve — never guess. List the live surface:

```
sok commands | grep plugin.soksak-plugin-runbook
```

`command.list scope=global` (or `project`) reads entries; `command.get commandId=<id>` returns one.

## Mental model

- **`scope`** is the first thing to decide: `global` (available everywhere) vs `project` (this project only). Most commands take `scope`; pass it explicitly.
- **An entry = `label` + `command`/`url` + `executionType`** (shell, http, …) + optional `groupId`, `favorite`, schedule fields.
- **References link entries.** A command body can contain `{{...}}` templates. `ref.parse template='…'` extracts the references in a template; `ref.resolve context=… template='…'` fills them in. `command.refs commandId=<id>` lists what one entry references — this is the dependency graph (cycles are rejected).
- **Scheduling**: entries carry `repeatType`/`intervalSec`/`scheduleAt`; `schedule.fire commandId=<id>` triggers one now. `reminderSecs` drives reminders.
- **History** records each run (output, statusCode, type); it has its own list/search/trash/restore, separate from entries.

## Core workflow

```
# save a shell command in the project scope
sok plugin.soksak-plugin-runbook.command.add scope=project label='deploy' \
  executionType=shell command='make deploy' groupId=<id>
# run it
sok plugin.soksak-plugin-runbook.command.run commandId=<id> scope=project
# read what happened
sok plugin.soksak-plugin-runbook.history.list scope=project limit=20
```

For chained entries, author the body with `{{...}}` and check `command.refs` before running so the graph resolves.

## Conventions

- Every command returns `{ok:true,…}` or `{ok:false,error}`. No throws — branch on `ok`.
- Always pass `scope` explicitly (global vs project). Deletes are soft (trash) — list with `trash=true`, then `restore` or `clear trashOnly=true`.
- It is **headless-complete** — you never need the GUI.
