import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { ManagedRun } from "../lib/types.js";
import {
  addSession,
  appendOutput,
  createSessionId,
  markBackgrounded,
  markExited,
} from "../lib/session-registry.js";
import { getProcessSupervisor } from "../lib/supervisor.js";
import { chunkString, sanitizeBinaryOutput } from "../lib/shared.js";
import type { ProcessSession } from "../lib/types.js";

const DEFAULT_MAX_OUTPUT = 200_000;
const DEFAULT_PENDING_MAX_OUTPUT = 30_000;

function resolveWorkdir(workdir: string): string {
  try {
    const stats = statSync(workdir);
    if (stats.isDirectory()) return workdir;
  } catch { /* ignore */ }
  const cwd = safeCwd();
  return cwd ?? homedir();
}

function safeCwd(): string | null {
  try {
    const cwd = process.cwd();
    return existsSync(cwd) ? cwd : null;
  } catch {
    return null;
  }
}

export type ExecArgs = {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  background?: boolean;
  timeout?: number;
  pty?: boolean;
};

export type ExecResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export async function handleExec(args: ExecArgs): Promise<ExecResult> {
  const { command, background, pty: usePty } = args;

  if (!command) {
    return { content: [{ type: "text", text: "Provide a command to start." }], isError: true };
  }

  const warnings: string[] = [];
  const rawWorkdir = args.workdir?.trim() || safeCwd() || homedir();
  const workdir = resolveWorkdir(rawWorkdir);
  if (workdir !== rawWorkdir) {
    warnings.push(`Warning: workdir "${rawWorkdir}" is unavailable; using "${workdir}".`);
  }

  const baseEnv = { ...process.env } as Record<string, string>;
  const env = args.env ? { ...baseEnv, ...args.env } : baseEnv;

  const timeoutMs =
    typeof args.timeout === "number" && args.timeout > 0
      ? Math.floor(args.timeout * 1000)
      : undefined;

  const sessionId = createSessionId();
  const startedAt = Date.now();
  const supervisor = getProcessSupervisor();

  const session: ProcessSession = {
    id: sessionId,
    command,
    stdin: undefined,
    pid: undefined,
    startedAt,
    cwd: workdir,
    maxOutputChars: DEFAULT_MAX_OUTPUT,
    pendingMaxOutputChars: DEFAULT_PENDING_MAX_OUTPUT,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    truncated: false,
    backgrounded: false,
  };
  addSession(session);

  const handleStdout = (data: string) => {
    const str = sanitizeBinaryOutput(data);
    for (const chunk of chunkString(str)) {
      appendOutput(session, "stdout", chunk);
    }
  };

  const handleStderr = (data: string) => {
    const str = sanitizeBinaryOutput(data);
    for (const chunk of chunkString(str)) {
      appendOutput(session, "stderr", chunk);
    }
  };

  // Determine spawn mode
  const shell = process.env.SHELL || "/bin/sh";
  const shellArgs = ["-c"];

  let managedRun: ManagedRun;
  let usingPty = usePty === true;

  try {
    if (usingPty) {
      try {
        managedRun = await supervisor.spawn({
          runId: sessionId,
          mode: "pty",
          ptyCommand: command,
          cwd: workdir,
          env: env as NodeJS.ProcessEnv,
          timeoutMs,
          captureOutput: false,
          onStdout: handleStdout,
          onStderr: handleStderr,
        });
      } catch (ptyErr) {
        // Fallback to child process if PTY fails
        warnings.push(`Warning: PTY spawn failed (${String(ptyErr)}); retrying without PTY.`);
        usingPty = false;
        managedRun = await supervisor.spawn({
          runId: sessionId,
          mode: "child",
          argv: [shell, ...shellArgs, command],
          cwd: workdir,
          env: env as NodeJS.ProcessEnv,
          stdinMode: "pipe-open",
          timeoutMs,
          captureOutput: false,
          onStdout: handleStdout,
          onStderr: handleStderr,
        });
      }
    } else {
      managedRun = await supervisor.spawn({
        runId: sessionId,
        mode: "child",
        argv: [shell, ...shellArgs, command],
        cwd: workdir,
        env: env as NodeJS.ProcessEnv,
        stdinMode: "pipe-closed",
        timeoutMs,
        captureOutput: false,
        onStdout: handleStdout,
        onStderr: handleStderr,
      });
    }
  } catch (err) {
    markExited(session, null, null, "failed");
    return {
      content: [{ type: "text", text: `Failed to spawn command: ${String(err)}` }],
      isError: true,
    };
  }

  session.stdin = managedRun.stdin;
  session.pid = managedRun.pid;

  const warningText = warnings.length ? `${warnings.join("\n")}\n\n` : "";

  // Background mode: return immediately with sessionId
  if (background) {
    markBackgrounded(session);
    return {
      content: [{
        type: "text",
        text: `${warningText}Command started in background (session ${sessionId}, pid ${session.pid ?? "n/a"}). Use process tool (list/poll/log/write/kill) for follow-up.`,
      }],
    };
  }

  // Foreground mode: wait for completion
  try {
    const exit = await managedRun.wait();
    const durationMs = Date.now() - startedAt;
    const isNormalExit = exit.reason === "exit";
    const exitCode = exit.exitCode ?? 0;
    const isShellFailure = exitCode === 126 || exitCode === 127;
    const status = isNormalExit && !isShellFailure ? "completed" : "failed";

    markExited(session, exit.exitCode, exit.exitSignal, status);
    const aggregated = session.aggregated.trim();

    if (status === "completed") {
      const exitMsg = exitCode !== 0 ? `\n\n(Command exited with code ${exitCode})` : "";
      return {
        content: [{ type: "text", text: `${warningText}${aggregated || "(no output)"}${exitMsg}` }],
      };
    }

    // Failed
    const reason = isShellFailure
      ? exitCode === 127 ? "Command not found" : "Command not executable (permission denied)"
      : exit.timedOut ? "Command timed out"
      : exit.exitSignal != null ? `Command aborted by signal ${exit.exitSignal}`
      : `Command failed with exit code ${exitCode}`;

    return {
      content: [{ type: "text", text: `${warningText}${aggregated ? `${aggregated}\n\n` : ""}${reason}` }],
      isError: true,
    };
  } catch (err) {
    markExited(session, null, null, "failed");
    return {
      content: [{ type: "text", text: `${warningText}Command failed: ${String(err)}` }],
      isError: true,
    };
  }
}
