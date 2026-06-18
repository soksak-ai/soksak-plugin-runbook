// 실행 엔진 공개 표면 — runCommand(링킹·셸/터미널) + 순수 링킹부(planLink) + 셸 어댑터.
// 타입별 실행은 engine 이 단일 진입(R8). API HTTP·일정 cron·secretRef Rust 주입은 후속.

export { runCommand, type RunDeps, type RunInput, type RunResult, type ExecuteApi } from "./engine";
export { planLink, type LinkPlan, type LinkOutcome } from "./link";
export { runShell, type ProcessApi, type ShellResult } from "./spawn";
