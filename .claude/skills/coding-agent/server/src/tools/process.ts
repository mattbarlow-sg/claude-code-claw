import { killProcessTree } from "../lib/kill-tree.js";
import { encodeKeySequence, encodePaste } from "../lib/pty-keys.js";
import {
  deleteSession,
  drainSession,
  getFinishedSession,
  getSession,
  listFinishedSessions,
  listRunningSessions,
  markExited,
} from "../lib/session-registry.js";
import {
  defaultTailNote,
  deriveSessionName,
  formatDurationCompact,
  pad,
  resolveLogSliceWindow,
  sliceLogLines,
  truncateMiddle,
} from "../lib/shared.js";
import { getProcessSupervisor } from "../lib/supervisor.js";
import type { ProcessSession } from "../lib/types.js";

type WritableStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroyed?: boolean;
};

const MAX_POLL_WAIT_MS = 120_000;

function resolvePollWaitMs(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(MAX_POLL_WAIT_MS, Math.floor(value)));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(MAX_POLL_WAIT_MS, parsed));
    }
  }
  return 0;
}

export type ProcessArgs = {
  action: string;
  sessionId?: string;
  data?: string;
  keys?: string[];
  hex?: string[];
  literal?: string;
  text?: string;
  bracketed?: boolean;
  eof?: boolean;
  offset?: number;
  limit?: number;
  timeout?: number;
};

export type ProcessResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

async function writeToStdin(stdin: WritableStdin, data: string) {
  await new Promise<void>((resolve, reject) => {
    stdin.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function handleProcess(params: ProcessArgs): Promise<ProcessResult> {
  const supervisor = getProcessSupervisor();

  const cancelManagedSession = (sessionId: string) => {
    const record = supervisor.getRecord(sessionId);
    if (!record || record.state === "exited") return false;
    supervisor.cancel(sessionId, "manual-cancel");
    return true;
  };

  const terminateSessionFallback = (session: ProcessSession) => {
    const pid = session.pid;
    if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
    killProcessTree(pid);
    return true;
  };

  const fail = (text: string): ProcessResult => ({
    content: [{ type: "text", text }],
    isError: true,
  });

  // LIST
  if (params.action === "list") {
    const running = listRunningSessions().map((s) => ({
      sessionId: s.id,
      status: "running",
      pid: s.pid ?? undefined,
      startedAt: s.startedAt,
      runtimeMs: Date.now() - s.startedAt,
      cwd: s.cwd,
      command: s.command,
      name: deriveSessionName(s.command),
      tail: s.tail,
      truncated: s.truncated,
    }));
    const finished = listFinishedSessions().map((s) => ({
      sessionId: s.id,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      runtimeMs: s.endedAt - s.startedAt,
      cwd: s.cwd,
      command: s.command,
      name: deriveSessionName(s.command),
      tail: s.tail,
      truncated: s.truncated,
      exitCode: s.exitCode ?? undefined,
      exitSignal: s.exitSignal ?? undefined,
    }));
    const lines = [...running, ...finished]
      .toSorted((a, b) => b.startedAt - a.startedAt)
      .map((s) => {
        const label = s.name ? truncateMiddle(s.name, 80) : truncateMiddle(s.command, 120);
        return `${s.sessionId} ${pad(s.status, 9)} ${formatDurationCompact(s.runtimeMs) ?? "n/a"} :: ${label}`;
      });
    return {
      content: [{ type: "text", text: lines.join("\n") || "No running or recent sessions." }],
    };
  }

  // All other actions require sessionId
  if (!params.sessionId) {
    return fail("sessionId is required for this action.");
  }

  const session = getSession(params.sessionId);
  const finished = getFinishedSession(params.sessionId);

  const resolveBackgroundedWritableStdin = () => {
    if (!session) {
      return { ok: false as const, result: fail(`No active session found for ${params.sessionId}`) };
    }
    if (!session.backgrounded) {
      return { ok: false as const, result: fail(`Session ${params.sessionId} is not backgrounded.`) };
    }
    const stdin = session.stdin;
    if (!stdin || stdin.destroyed) {
      return { ok: false as const, result: fail(`Session ${params.sessionId} stdin is not writable.`) };
    }
    return { ok: true as const, session, stdin: stdin as WritableStdin };
  };

  const runningResult = (sess: ProcessSession, text: string): ProcessResult => ({
    content: [{ type: "text", text }],
  });

  switch (params.action) {
    case "poll": {
      if (!session) {
        if (finished) {
          return {
            content: [{
              type: "text",
              text:
                (finished.tail || `(no output recorded${finished.truncated ? " - truncated to cap" : ""})`) +
                `\n\nProcess exited with ${
                  finished.exitSignal ? `signal ${finished.exitSignal}` : `code ${finished.exitCode ?? 0}`
                }.`,
            }],
          };
        }
        return fail(`No session found for ${params.sessionId}`);
      }
      if (!session.backgrounded) {
        return fail(`Session ${params.sessionId} is not backgrounded.`);
      }

      const pollWaitMs = resolvePollWaitMs(params.timeout);
      if (pollWaitMs > 0 && !session.exited) {
        const deadline = Date.now() + pollWaitMs;
        while (!session.exited && Date.now() < deadline) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.max(0, Math.min(250, deadline - Date.now()))),
          );
        }
      }

      const { stdout, stderr } = drainSession(session);
      const exited = session.exited;
      const exitCode = session.exitCode ?? 0;
      const exitSignal = session.exitSignal ?? undefined;
      if (exited) {
        const status = exitCode === 0 && exitSignal == null ? "completed" : "failed";
        markExited(session, session.exitCode ?? null, session.exitSignal ?? null, status);
      }
      const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n").trim();
      return {
        content: [{
          type: "text",
          text:
            (output || "(no new output)") +
            (exited
              ? `\n\nProcess exited with ${exitSignal ? `signal ${exitSignal}` : `code ${exitCode}`}.`
              : "\n\nProcess still running."),
        }],
      };
    }

    case "log": {
      if (session) {
        if (!session.backgrounded) {
          return fail(`Session ${params.sessionId} is not backgrounded.`);
        }
        const window = resolveLogSliceWindow(params.offset, params.limit);
        const { slice, totalLines, totalChars } = sliceLogLines(
          session.aggregated,
          window.effectiveOffset,
          window.effectiveLimit,
        );
        const logDefaultTailNote = defaultTailNote(totalLines, window.usingDefaultTail);
        return {
          content: [{ type: "text", text: (slice || "(no output yet)") + logDefaultTailNote }],
        };
      }
      if (finished) {
        const window = resolveLogSliceWindow(params.offset, params.limit);
        const { slice, totalLines } = sliceLogLines(
          finished.aggregated,
          window.effectiveOffset,
          window.effectiveLimit,
        );
        const logDefaultTailNote = defaultTailNote(totalLines, window.usingDefaultTail);
        return {
          content: [{ type: "text", text: (slice || "(no output recorded)") + logDefaultTailNote }],
        };
      }
      return fail(`No session found for ${params.sessionId}`);
    }

    case "write": {
      const resolved = resolveBackgroundedWritableStdin();
      if (!resolved.ok) return resolved.result;
      await writeToStdin(resolved.stdin, params.data ?? "");
      if (params.eof) resolved.stdin.end();
      return runningResult(
        resolved.session,
        `Wrote ${(params.data ?? "").length} bytes to session ${params.sessionId}${
          params.eof ? " (stdin closed)" : ""
        }.`,
      );
    }

    case "send-keys": {
      const resolved = resolveBackgroundedWritableStdin();
      if (!resolved.ok) return resolved.result;
      const { data, warnings } = encodeKeySequence({
        keys: params.keys,
        hex: params.hex,
        literal: params.literal,
      });
      if (!data) return fail("No key data provided.");
      await writeToStdin(resolved.stdin, data);
      return runningResult(
        resolved.session,
        `Sent ${data.length} bytes to session ${params.sessionId}.` +
          (warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : ""),
      );
    }

    case "submit": {
      const resolved = resolveBackgroundedWritableStdin();
      if (!resolved.ok) return resolved.result;
      await writeToStdin(resolved.stdin, "\r");
      return runningResult(
        resolved.session,
        `Submitted session ${params.sessionId} (sent CR).`,
      );
    }

    case "paste": {
      const resolved = resolveBackgroundedWritableStdin();
      if (!resolved.ok) return resolved.result;
      const payload = encodePaste(params.text ?? "", params.bracketed !== false);
      if (!payload) return fail("No paste text provided.");
      await writeToStdin(resolved.stdin, payload);
      return runningResult(
        resolved.session,
        `Pasted ${params.text?.length ?? 0} chars to session ${params.sessionId}.`,
      );
    }

    case "kill": {
      if (!session) return fail(`No active session found for ${params.sessionId}`);
      if (!session.backgrounded) return fail(`Session ${params.sessionId} is not backgrounded.`);
      const canceled = cancelManagedSession(session.id);
      if (!canceled) {
        const terminated = terminateSessionFallback(session);
        if (!terminated) {
          return fail(`Unable to terminate session ${params.sessionId}: no active supervisor run or process id.`);
        }
        markExited(session, null, "SIGKILL", "failed");
      }
      return {
        content: [{
          type: "text",
          text: canceled
            ? `Termination requested for session ${params.sessionId}.`
            : `Killed session ${params.sessionId}.`,
        }],
      };
    }

    case "clear": {
      if (finished) {
        deleteSession(params.sessionId);
        return { content: [{ type: "text", text: `Cleared session ${params.sessionId}.` }] };
      }
      return fail(`No finished session found for ${params.sessionId}`);
    }

    case "remove": {
      if (session) {
        const canceled = cancelManagedSession(session.id);
        if (canceled) {
          session.backgrounded = false;
          deleteSession(params.sessionId);
        } else {
          const terminated = terminateSessionFallback(session);
          if (!terminated) {
            return fail(`Unable to remove session ${params.sessionId}: no active supervisor run or process id.`);
          }
          markExited(session, null, "SIGKILL", "failed");
          deleteSession(params.sessionId);
        }
        return {
          content: [{
            type: "text",
            text: canceled
              ? `Removed session ${params.sessionId} (termination requested).`
              : `Removed session ${params.sessionId}.`,
          }],
        };
      }
      if (finished) {
        deleteSession(params.sessionId);
        return { content: [{ type: "text", text: `Removed session ${params.sessionId}.` }] };
      }
      return fail(`No session found for ${params.sessionId}`);
    }

    default:
      return fail(`Unknown action "${params.action}"`);
  }
}
