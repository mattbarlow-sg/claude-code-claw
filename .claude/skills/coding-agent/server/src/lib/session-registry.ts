import { createSessionSlug } from "./session-slug.js";
import { tail as tailFn } from "./shared.js";
import type { FinishedSession, ProcessSession, ProcessStatus } from "./types.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;

let jobTtlMs = DEFAULT_JOB_TTL_MS;

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();
let sweeper: NodeJS.Timeout | null = null;

function isSessionIdTaken(id: string) {
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionId(): string {
  return createSessionSlug(isSessionIdTaken);
}

export function addSession(session: ProcessSession) {
  runningSessions.set(session.id, session);
  startSweeper();
}

export function getSession(id: string) {
  return runningSessions.get(id);
}

export function getFinishedSession(id: string) {
  return finishedSessions.get(id);
}

export function deleteSession(id: string) {
  runningSessions.delete(id);
  finishedSessions.delete(id);
}

export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);

  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );

  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;

  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tailFn(session.aggregated, 2000);
}

export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
) {
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.tail = tailFn(session.aggregated, 2000);
  moveToFinished(session, status);
}

export function markBackgrounded(session: ProcessSession) {
  session.backgrounded = true;
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);

  // Clean up stdin
  if (session.stdin) {
    if (typeof session.stdin.destroy === "function") {
      session.stdin.destroy();
    } else if (typeof session.stdin.end === "function") {
      session.stdin.end();
    }
    try {
      (session.stdin as { destroyed?: boolean }).destroyed = true;
    } catch { /* ignore */ }
    delete session.stdin;
  }

  if (!session.backgrounded) return;

  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
  });
}

export function listRunningSessions() {
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

export function listFinishedSessions() {
  return Array.from(finishedSessions.values());
}

export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) return;
  jobTtlMs = Math.min(Math.max(value, 60_000), 3 * 60 * 60 * 1000);
  stopSweeper();
  startSweeper();
}

function trimWithCap(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) total += chunk.length;
  return total;
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number) {
  if (pendingChars <= cap) return pendingChars;
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  while (buffer.length && pendingChars - buffer[0].length >= cap) {
    pendingChars -= buffer[0].length;
    buffer.shift();
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

function pruneFinishedSessions() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
    }
  }
}

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) return;
  clearInterval(sweeper);
  sweeper = null;
}
