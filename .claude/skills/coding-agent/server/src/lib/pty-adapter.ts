import { killProcessTree } from "./kill-tree.js";
import type { ManagedRunStdin, SpawnProcessAdapter } from "./types.js";

const FORCE_KILL_WAIT_FALLBACK_MS = 4000;

type PtyExitEvent = { exitCode: number; signal?: number };
type PtyDisposable = { dispose: () => void };
type PtySpawnHandle = {
  pid: number;
  write: (data: string | Buffer) => void;
  onData: (listener: (value: string) => void) => PtyDisposable | void;
  onExit: (listener: (event: PtyExitEvent) => void) => PtyDisposable | void;
  kill: (signal?: string) => void;
};
type PtySpawn = (
  file: string,
  args: string[] | string,
  options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  },
) => PtySpawnHandle;

type PtyModule = {
  spawn?: PtySpawn;
  default?: { spawn?: PtySpawn };
};

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export async function createPtyAdapter(params: {
  shell: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}): Promise<SpawnProcessAdapter> {
  // Try multiple PTY packages
  let spawn: PtySpawn | undefined;
  for (const pkg of ["node-pty", "@lydell/node-pty"]) {
    try {
      const mod = (await import(pkg)) as unknown as PtyModule;
      spawn = mod.spawn ?? mod.default?.spawn;
      if (spawn) break;
    } catch {
      continue;
    }
  }
  if (!spawn) {
    throw new Error("PTY support is unavailable (no node-pty package found).");
  }

  const pty = spawn(params.shell, params.args, {
    cwd: params.cwd,
    env: params.env ? toStringEnv(params.env) : undefined,
    name: process.env.TERM ?? "xterm-256color",
    cols: params.cols ?? 120,
    rows: params.rows ?? 30,
  });

  // Buffer early data events that arrive before onStdout listener is registered.
  // PTY processes can start producing output immediately after spawn.
  let earlyBuffer: string[] = [];
  let externalListener: ((chunk: string) => void) | null = null;

  const earlyDataDisposable =
    pty.onData((chunk) => {
      const str = chunk.toString();
      if (externalListener) {
        externalListener(str);
      } else {
        earlyBuffer.push(str);
      }
    }) ?? null;

  let exitListener: PtyDisposable | null = null;
  let waitResult: { code: number | null; signal: NodeJS.Signals | number | null } | null = null;
  let resolveWait:
    | ((value: { code: number | null; signal: NodeJS.Signals | number | null }) => void)
    | null = null;
  let waitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | number | null }> | null =
    null;
  let forceKillWaitFallbackTimer: NodeJS.Timeout | null = null;

  const clearForceKillWaitFallback = () => {
    if (!forceKillWaitFallbackTimer) return;
    clearTimeout(forceKillWaitFallbackTimer);
    forceKillWaitFallbackTimer = null;
  };

  const settleWait = (value: { code: number | null; signal: NodeJS.Signals | number | null }) => {
    if (waitResult) return;
    clearForceKillWaitFallback();
    waitResult = value;
    if (resolveWait) {
      const resolve = resolveWait;
      resolveWait = null;
      resolve(value);
    }
  };

  const scheduleForceKillWaitFallback = (signal: NodeJS.Signals) => {
    clearForceKillWaitFallback();
    forceKillWaitFallbackTimer = setTimeout(() => {
      settleWait({ code: null, signal });
    }, FORCE_KILL_WAIT_FALLBACK_MS);
    forceKillWaitFallbackTimer.unref();
  };

  exitListener =
    pty.onExit((event) => {
      // PTY processes commonly get SIGHUP (signal 1) on normal exit when the slave
      // PTY closes. Treat SIGHUP as a normal exit when the exit code is 0.
      const rawSignal = event.signal && event.signal !== 0 ? event.signal : null;
      const isNormalSighup = rawSignal === 1 && (event.exitCode === 0 || event.exitCode == null);
      const signal = isNormalSighup ? null : rawSignal;
      const code = event.exitCode ?? (isNormalSighup ? 0 : null);
      // Delay settling to let remaining data events flush through.
      // PTY hosts can fire onExit before all onData events have been delivered.
      setTimeout(() => {
        settleWait({ code, signal });
      }, 100);
    }) ?? null;

  const stdin: ManagedRunStdin = {
    destroyed: false,
    write: (data, cb) => {
      try {
        pty.write(data);
        cb?.(null);
      } catch (err) {
        cb?.(err as Error);
      }
    },
    end: () => {
      try {
        pty.write("\x04"); // EOF
      } catch {
        // ignore EOF errors
      }
    },
  };

  const onStdout = (listener: (chunk: string) => void) => {
    externalListener = listener;
    // Flush any data that arrived before the listener was registered
    if (earlyBuffer.length > 0) {
      for (const chunk of earlyBuffer) {
        listener(chunk);
      }
      earlyBuffer = [];
    }
  };

  const onStderr = (_listener: (chunk: string) => void) => {
    // PTY gives a unified output stream
  };

  const wait = async () => {
    if (waitResult) return waitResult;
    if (!waitPromise) {
      waitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | number | null }>(
        (resolve) => {
          resolveWait = resolve;
          if (waitResult) {
            const settled = waitResult;
            resolveWait = null;
            resolve(settled);
          }
        },
      );
    }
    return waitPromise;
  };

  const kill = (signal: NodeJS.Signals = "SIGKILL") => {
    try {
      if (signal === "SIGKILL" && typeof pty.pid === "number" && pty.pid > 0) {
        killProcessTree(pty.pid);
      } else {
        pty.kill(signal);
      }
    } catch {
      // ignore kill errors
    }
    if (signal === "SIGKILL") {
      scheduleForceKillWaitFallback(signal);
    }
  };

  const dispose = () => {
    try { earlyDataDisposable?.dispose(); } catch { /* ignore */ }
    try { exitListener?.dispose(); } catch { /* ignore */ }
    clearForceKillWaitFallback();
    externalListener = null;
    exitListener = null;
    settleWait({ code: null, signal: null });
  };

  return {
    pid: pty.pid || undefined,
    stdin,
    onStdout,
    onStderr,
    wait,
    kill,
    dispose,
  };
}
