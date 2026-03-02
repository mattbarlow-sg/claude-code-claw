import crypto from "node:crypto";
import { createChildAdapter } from "./child-adapter.js";
import { createPtyAdapter } from "./pty-adapter.js";
import type {
  ManagedRun,
  RunExit,
  RunRecord,
  RunState,
  SpawnInput,
  TerminationReason,
} from "./types.js";

function getShellConfig(): { shell: string; args: string[] } {
  const shell = process.env.SHELL || "/bin/sh";
  return { shell, args: ["-c"] };
}

function clampTimeout(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function isTimeoutReason(reason: TerminationReason) {
  return reason === "overall-timeout" || reason === "no-output-timeout";
}

// Simple in-memory run registry
function createRunRegistry() {
  const records = new Map<string, RunRecord>();

  return {
    add(record: RunRecord) {
      records.set(record.runId, { ...record });
    },
    get(runId: string): RunRecord | undefined {
      const r = records.get(runId);
      return r ? { ...r } : undefined;
    },
    updateState(
      runId: string,
      state: RunState,
      patch?: Partial<Pick<RunRecord, "pid" | "terminationReason" | "exitCode" | "exitSignal">>,
    ) {
      const current = records.get(runId);
      if (!current) return;
      records.set(runId, { ...current, ...patch, state });
    },
    touchOutput(runId: string) {
      const current = records.get(runId);
      if (!current) return;
      records.set(runId, { ...current, lastOutputAtMs: Date.now() });
    },
    finalize(
      runId: string,
      exit: { reason: TerminationReason; exitCode: number | null; exitSignal: NodeJS.Signals | number | null },
    ) {
      const current = records.get(runId);
      if (!current) return;
      records.set(runId, {
        ...current,
        state: "exited",
        terminationReason: current.terminationReason ?? exit.reason,
        exitCode: current.exitCode !== undefined ? current.exitCode : exit.exitCode,
        exitSignal: current.exitSignal !== undefined ? current.exitSignal : exit.exitSignal,
      });
    },
  };
}

export type ProcessSupervisor = {
  spawn(input: SpawnInput): Promise<ManagedRun>;
  cancel(runId: string, reason?: TerminationReason): void;
  getRecord(runId: string): RunRecord | undefined;
};

export function createProcessSupervisor(): ProcessSupervisor {
  const registry = createRunRegistry();
  const active = new Map<string, { run: ManagedRun }>();

  const cancel = (runId: string, reason: TerminationReason = "manual-cancel") => {
    const current = active.get(runId);
    if (!current) return;
    registry.updateState(runId, "exiting", { terminationReason: reason });
    current.run.cancel(reason);
  };

  const spawn = async (input: SpawnInput): Promise<ManagedRun> => {
    const runId = input.runId?.trim() || crypto.randomUUID();
    const startedAtMs = Date.now();
    const record: RunRecord = {
      runId,
      state: "starting",
      startedAtMs,
      lastOutputAtMs: startedAtMs,
    };
    registry.add(record);

    let forcedReason: TerminationReason | null = null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;

    const overallTimeoutMs = clampTimeout(input.timeoutMs);
    const noOutputTimeoutMs = clampTimeout(input.noOutputTimeoutMs);

    const setForcedReason = (reason: TerminationReason) => {
      if (forcedReason) return;
      forcedReason = reason;
      registry.updateState(runId, "exiting", { terminationReason: reason });
    };

    let cancelAdapter: ((reason: TerminationReason) => void) | null = null;

    const requestCancel = (reason: TerminationReason) => {
      setForcedReason(reason);
      cancelAdapter?.(reason);
    };

    const touchOutput = () => {
      registry.touchOutput(runId);
      if (!noOutputTimeoutMs || settled) return;
      if (noOutputTimer) clearTimeout(noOutputTimer);
      noOutputTimer = setTimeout(() => {
        requestCancel("no-output-timeout");
      }, noOutputTimeoutMs);
    };

    try {
      const adapter =
        input.mode === "pty"
          ? await (async () => {
              const { shell, args: shellArgs } = getShellConfig();
              const ptyCommand = input.ptyCommand.trim();
              if (!ptyCommand) throw new Error("PTY command cannot be empty");
              return await createPtyAdapter({
                shell,
                args: [...shellArgs, ptyCommand],
                cwd: input.cwd,
                env: input.env,
              });
            })()
          : await createChildAdapter({
              argv: input.argv,
              cwd: input.cwd,
              env: input.env,
              stdinMode: input.stdinMode,
            });

      registry.updateState(runId, "running", { pid: adapter.pid });

      const clearTimers = () => {
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
        if (noOutputTimer) { clearTimeout(noOutputTimer); noOutputTimer = null; }
      };

      cancelAdapter = (_reason: TerminationReason) => {
        if (settled) return;
        adapter.kill("SIGKILL");
      };

      if (overallTimeoutMs) {
        timeoutTimer = setTimeout(() => requestCancel("overall-timeout"), overallTimeoutMs);
      }
      if (noOutputTimeoutMs) {
        noOutputTimer = setTimeout(() => requestCancel("no-output-timeout"), noOutputTimeoutMs);
      }

      adapter.onStdout((chunk) => {
        if (captureOutput) stdout += chunk;
        input.onStdout?.(chunk);
        touchOutput();
      });
      adapter.onStderr((chunk) => {
        if (captureOutput) stderr += chunk;
        input.onStderr?.(chunk);
        touchOutput();
      });

      const waitPromise = (async (): Promise<RunExit> => {
        const result = await adapter.wait();
        if (settled) {
          return {
            reason: forcedReason ?? "exit",
            exitCode: result.code,
            exitSignal: result.signal,
            durationMs: Date.now() - startedAtMs,
            stdout,
            stderr,
            timedOut: isTimeoutReason(forcedReason ?? "exit"),
          };
        }
        settled = true;
        clearTimers();
        adapter.dispose();
        active.delete(runId);

        const reason: TerminationReason =
          forcedReason ?? (result.signal != null ? "signal" : "exit");
        const exit: RunExit = {
          reason,
          exitCode: result.code,
          exitSignal: result.signal,
          durationMs: Date.now() - startedAtMs,
          stdout,
          stderr,
          timedOut: isTimeoutReason(forcedReason ?? reason),
        };
        registry.finalize(runId, {
          reason: exit.reason,
          exitCode: exit.exitCode,
          exitSignal: exit.exitSignal,
        });
        return exit;
      })().catch((err) => {
        if (!settled) {
          settled = true;
          clearTimers();
          active.delete(runId);
          adapter.dispose();
          registry.finalize(runId, { reason: "spawn-error", exitCode: null, exitSignal: null });
        }
        throw err;
      });

      const managedRun: ManagedRun = {
        runId,
        pid: adapter.pid,
        startedAtMs,
        stdin: adapter.stdin,
        wait: async () => await waitPromise,
        cancel: (reason = "manual-cancel") => requestCancel(reason),
      };

      active.set(runId, { run: managedRun });
      return managedRun;
    } catch (err) {
      registry.finalize(runId, { reason: "spawn-error", exitCode: null, exitSignal: null });
      throw err;
    }
  };

  return {
    spawn,
    cancel,
    getRecord: (runId: string) => registry.get(runId),
  };
}

// Singleton
let singleton: ProcessSupervisor | null = null;

export function getProcessSupervisor(): ProcessSupervisor {
  if (singleton) return singleton;
  singleton = createProcessSupervisor();
  return singleton;
}
