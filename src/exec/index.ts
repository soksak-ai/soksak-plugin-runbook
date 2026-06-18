// 실행 엔진 공개 표면 — runCommand(링킹·셸/터미널/api) + 순수 링킹부(planLink) + 셸 어댑터 +
// schedule 예약(arm). 타입별 실행은 engine 이 단일 진입(R8).

export {
  runCommand,
  type RunDeps,
  type RunInput,
  type RunResult,
  type ExecuteApi,
  type NetworkApi,
  type SecretsProbe,
} from "./engine";
export { planLink, type LinkPlan, type LinkOutcome } from "./link";
export { runShell, type ProcessApi, type ShellResult } from "./spawn";
export { nextOccurrence } from "./schedule";
export { armSchedule, cancelSchedule, type ArmResult } from "./arm";
