export type RunState = "starting" | "running" | "exiting" | "exited";

export type TerminationReason =
  | "manual-cancel"
  | "overall-timeout"
  | "no-output-timeout"
  | "spawn-error"
  | "signal"
  | "exit";

export type ManagedRunStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroy?: () => void;
  destroyed?: boolean;
};

export type SpawnProcessAdapter = {
  pid?: number;
  stdin?: ManagedRunStdin;
  onStdout: (listener: (chunk: string) => void) => void;
  onStderr: (listener: (chunk: string) => void) => void;
  wait: () => Promise<{ code: number | null; signal: NodeJS.Signals | number | null }>;
  kill: (signal?: NodeJS.Signals) => void;
  dispose: () => void;
};

export type RunRecord = {
  runId: string;
  state: RunState;
  pid?: number;
  startedAtMs: number;
  lastOutputAtMs: number;
  terminationReason?: TerminationReason;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
};

export type RunExit = {
  reason: TerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ManagedRun = {
  runId: string;
  pid?: number;
  startedAtMs: number;
  stdin?: ManagedRunStdin;
  wait: () => Promise<RunExit>;
  cancel: (reason?: TerminationReason) => void;
};

export type SpawnBaseInput = {
  runId?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  captureOutput?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type SpawnChildInput = SpawnBaseInput & {
  mode: "child";
  argv: string[];
  stdinMode?: "pipe-open" | "pipe-closed";
};

export type SpawnPtyInput = SpawnBaseInput & {
  mode: "pty";
  ptyCommand: string;
};

export type SpawnInput = SpawnChildInput | SpawnPtyInput;

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroy?: () => void;
  destroyed?: boolean;
};

export interface ProcessSession {
  id: string;
  command: string;
  stdin?: SessionStdin;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exited: boolean;
  truncated: boolean;
  backgrounded: boolean;
}

export interface FinishedSession {
  id: string;
  command: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  totalOutputChars: number;
}
