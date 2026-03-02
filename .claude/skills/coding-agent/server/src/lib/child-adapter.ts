import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { killProcessTree } from "./kill-tree.js";
import type { ManagedRunStdin, SpawnProcessAdapter } from "./types.js";

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export async function createChildAdapter(params: {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinMode?: "pipe-open" | "pipe-closed";
}): Promise<SpawnProcessAdapter> {
  const resolvedArgv = [...params.argv];
  const stdinMode = params.stdinMode ?? "pipe-closed";

  const options: SpawnOptions = {
    cwd: params.cwd,
    env: params.env ? toStringEnv(params.env) : undefined,
    stdio: stdinMode === "pipe-open" ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    detached: true,
    windowsHide: true,
  };

  const child = nodeSpawn(
    resolvedArgv[0],
    resolvedArgv.slice(1),
    options,
  ) as unknown as ChildProcessWithoutNullStreams;

  if (child.stdin && stdinMode === "pipe-closed") {
    child.stdin.end();
  }

  const stdin: ManagedRunStdin | undefined = child.stdin
    ? {
        destroyed: false,
        write: (data: string, cb?: (err?: Error | null) => void) => {
          try {
            child.stdin.write(data, cb);
          } catch (err) {
            cb?.(err as Error);
          }
        },
        end: () => {
          try { child.stdin.end(); } catch { /* ignore */ }
        },
        destroy: () => {
          try { child.stdin.destroy(); } catch { /* ignore */ }
        },
      }
    : undefined;

  const onStdout = (listener: (chunk: string) => void) => {
    child.stdout.on("data", (chunk: Buffer) => {
      listener(chunk.toString());
    });
  };

  const onStderr = (listener: (chunk: string) => void) => {
    child.stderr.on("data", (chunk: Buffer) => {
      listener(chunk.toString());
    });
  };

  const wait = async () =>
    await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });

  const kill = (signal?: NodeJS.Signals) => {
    const pid = child.pid ?? undefined;
    if (signal === undefined || signal === "SIGKILL") {
      if (pid) {
        killProcessTree(pid);
      } else {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
      return;
    }
    try { child.kill(signal); } catch { /* ignore */ }
  };

  const dispose = () => {
    child.removeAllListeners();
  };

  return {
    pid: child.pid ?? undefined,
    stdin,
    onStdout,
    onStderr,
    wait,
    kill,
    dispose,
  };
}
