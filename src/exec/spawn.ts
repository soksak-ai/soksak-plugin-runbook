// 셸 실행 어댑터 — app.process.spawn + onData/onExit 를 단일 Promise 로 감싼다(R8 단일엔진).
//
// process_spawn 은 cmd+args 를 직접 exec(셸 아님)하므로, 셸 문법(파이프·치환·&&)을 쓰려면
// 셸을 -c 로 띄운다. stdout/stderr 는 onData/onStderr 로 누적, onExit 로 종료코드를 받는다.
// 리스너 등록 전 도착분은 코어가 버퍼해 재생하므로(api.ts subscribe) 유실 0.

/** app.process 표면(필요한 메서드만). "process" 권한으로 노출된다. */
export interface ProcessApi {
  spawn: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string>; envRemove?: string[] },
  ) => Promise<number>;
  onData: (handle: number, cb: (data: Uint8Array) => void) => { dispose: () => void };
  onStderr: (handle: number, cb: (data: Uint8Array) => void) => { dispose: () => void };
  onExit: (handle: number, cb: (code: number) => void) => { dispose: () => void };
  kill: (handle: number) => Promise<void>;
}

export interface ShellResult {
  /** stdout(주 출력 — 링킹·jsonPath 추출 대상). */
  stdout: string;
  /** stderr(부 출력 — 진단). */
  stderr: string;
  /** 합본 출력(히스토리·표시용). */
  output: string;
  exitCode: number;
}

/** 사용자 셸 — 로그인 셸 환경을 흉내내지 않고 POSIX sh 로 고정(예측 가능·이식성). -c 로 한 줄 실행. */
const SHELL = "/bin/sh";

const decode = (() => {
  const dec = new TextDecoder();
  return (b: Uint8Array): string => dec.decode(b);
})();

/** resolved 셸 명령 한 줄을 spawn 해 종료까지 stdout/stderr/exitCode 를 모은다. 단일 진입(R8). */
export function runShell(
  proc: ProcessApi,
  resolved: string,
  opts?: { cwd?: string; env?: Record<string, string> },
): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve, reject) => {
    let outBuf = "";
    let errBuf = "";
    const disposers: { dispose: () => void }[] = [];
    const cleanup = () => {
      for (const d of disposers.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* 격리 */
        }
      }
    };

    proc
      .spawn(SHELL, ["-c", resolved], opts)
      .then((handle) => {
        disposers.push(proc.onData(handle, (b) => (outBuf += decode(b))));
        disposers.push(proc.onStderr(handle, (b) => (errBuf += decode(b))));
        disposers.push(
          proc.onExit(handle, (code) => {
            cleanup();
            const output = errBuf ? `${outBuf}${errBuf}` : outBuf;
            resolve({ stdout: outBuf, stderr: errBuf, output, exitCode: code });
          }),
        );
      })
      .catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}
