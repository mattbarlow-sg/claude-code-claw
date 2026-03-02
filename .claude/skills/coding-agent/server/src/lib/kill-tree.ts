const DEFAULT_GRACE_MS = 3000;
const MAX_GRACE_MS = 60_000;

function normalizeGraceMs(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GRACE_MS;
  }
  return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort process-tree termination with graceful shutdown.
 * Sends SIGTERM to process group first, waits grace period, then SIGKILL.
 */
export function killProcessTree(pid: number, opts?: { graceMs?: number }): void {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  const graceMs = normalizeGraceMs(opts?.graceMs);

  // Step 1: Try graceful SIGTERM to process group
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  // Step 2: Wait grace period, then SIGKILL if still alive
  setTimeout(() => {
    if (isProcessAlive(-pid)) {
      try {
        process.kill(-pid, "SIGKILL");
        return;
      } catch {
        // Fall through to direct pid kill
      }
    }
    if (!isProcessAlive(pid)) {
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited between liveness check and kill
    }
  }, graceMs).unref();
}
