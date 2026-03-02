const DEFAULT_LOG_TAIL_LINES = 200;

export function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins}m`;
}

export function truncateMiddle(str: string, max: number): string {
  if (str.length <= max) {
    return str;
  }
  const half = Math.floor((max - 3) / 2);
  return `${str.slice(0, half)}...${str.slice(-half)}`;
}

export function sliceLogLines(
  text: string,
  offset?: number,
  limit?: number,
): { slice: string; totalLines: number; totalChars: number } {
  if (!text) {
    return { slice: "", totalLines: 0, totalChars: 0 };
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const totalLines = lines.length;
  const totalChars = text.length;
  let start =
    typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  if (limit !== undefined && offset === undefined) {
    const tailCount = Math.max(0, Math.floor(limit));
    start = Math.max(totalLines - tailCount, 0);
  }
  const end =
    typeof limit === "number" && Number.isFinite(limit)
      ? start + Math.max(0, Math.floor(limit))
      : undefined;
  return { slice: lines.slice(start, end).join("\n"), totalLines, totalChars };
}

export function deriveSessionName(command: string): string | undefined {
  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return undefined;
  }
  const verb = tokens[0];
  let target = tokens.slice(1).find((t) => !t.startsWith("-"));
  if (!target) {
    target = tokens[1];
  }
  if (!target) {
    return verb;
  }
  const cleaned = truncateMiddle(stripQuotes(target), 48);
  return `${stripQuotes(verb)} ${cleaned}`;
}

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/(?:[^\s"']+|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) ?? [];
  return matches.map((token) => stripQuotes(token)).filter(Boolean);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function pad(str: string, width: number): string {
  if (str.length >= width) {
    return str;
  }
  return str + " ".repeat(width - str.length);
}

export function tail(text: string, max = 2000): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

export function resolveLogSliceWindow(offset?: number, limit?: number) {
  const usingDefaultTail = offset === undefined && limit === undefined;
  const effectiveLimit =
    typeof limit === "number" && Number.isFinite(limit)
      ? limit
      : usingDefaultTail
        ? DEFAULT_LOG_TAIL_LINES
        : undefined;
  return { effectiveOffset: offset, effectiveLimit, usingDefaultTail };
}

export function defaultTailNote(totalLines: number, usingDefaultTail: boolean): string {
  if (!usingDefaultTail || totalLines <= DEFAULT_LOG_TAIL_LINES) {
    return "";
  }
  return `\n\n[showing last ${DEFAULT_LOG_TAIL_LINES} of ${totalLines} lines; pass offset/limit to page]`;
}

export function sanitizeBinaryOutput(text: string): string {
  // Strip non-printable control chars except common whitespace and ANSI escapes
  return text.replace(/[\x00-\x08\x0e-\x1a\x7f]/g, "");
}

export function chunkString(input: string, limit = 8192): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += limit) {
    chunks.push(input.slice(i, i + limit));
  }
  return chunks;
}
