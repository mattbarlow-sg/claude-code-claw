import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleExec } from "./tools/exec.js";
import { handleProcess } from "./tools/process.js";

const server = new McpServer({
  name: "coding-agent",
  version: "1.0.0",
});

// exec tool: spawn commands with optional PTY and background support
server.tool(
  "exec",
  "Execute shell commands with optional PTY and background mode. Use pty=true for interactive terminal apps (coding agents like codex, claude, pi). Use background=true to run in background and manage via the process tool.",
  {
    command: z.string().describe("Shell command to execute"),
    workdir: z.string().optional().describe("Working directory (defaults to cwd)"),
    env: z.record(z.string()).optional().describe("Environment variables to set"),
    background: z.boolean().optional().describe("Run in background immediately, returns sessionId"),
    timeout: z.number().optional().describe("Timeout in seconds (kills process on expiry)"),
    pty: z.boolean().optional().describe("Run in a pseudo-terminal (PTY). Required for interactive CLIs and coding agents."),
  },
  async (args) => {
    const result = await handleExec(args);
    return result;
  },
);

// process tool: manage running/finished sessions
server.tool(
  "process",
  "Manage running exec sessions: list, poll, log, write, send-keys, submit, paste, kill, clear, remove.",
  {
    action: z.string().describe("Process action: list, poll, log, write, send-keys, submit, paste, kill, clear, remove"),
    sessionId: z.string().optional().describe("Session ID (required for all actions except list)"),
    data: z.string().optional().describe("Data to write (for write action)"),
    keys: z.array(z.string()).optional().describe("Key tokens to send (for send-keys action)"),
    hex: z.array(z.string()).optional().describe("Hex bytes to send (for send-keys action)"),
    literal: z.string().optional().describe("Literal string (for send-keys action)"),
    text: z.string().optional().describe("Text to paste (for paste action)"),
    bracketed: z.boolean().optional().describe("Wrap paste in bracketed mode (default true)"),
    eof: z.boolean().optional().describe("Close stdin after write"),
    offset: z.number().optional().describe("Log offset (for log action)"),
    limit: z.number().optional().describe("Log line limit (for log action)"),
    timeout: z.number().optional().describe("For poll: wait up to this many milliseconds before returning"),
  },
  async (args) => {
    const result = await handleProcess(args);
    return result;
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
