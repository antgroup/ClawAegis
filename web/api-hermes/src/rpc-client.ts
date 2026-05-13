/**
 * JSON-RPC client for communicating with AegisRpcRuntime.
 *
 * This client spawns the rpc-server.ts as a subprocess and communicates
 * via line-delimited JSON over stdin/stdout.
 */

import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RpcRequest = {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcResponse = {
  id: number | string;
  result?: unknown;
  error?: { message: string; code?: number };
};

export class AegisRpcClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number | string,
    { resolve: (value: RpcResponse) => void; reject: (reason: Error) => void }
  >();
  private ready = false;
  private readyCallbacks: (() => void)[] = [];
  private rpcServerPath: string;

  constructor(rpcServerPath?: string) {
    // Default to looking for rpc-server.js in the project root
    this.rpcServerPath =
      rpcServerPath ??
      path.resolve(__dirname, "../../../../rpc-server.js");
  }

  start(): void {
    if (this.process) {
      return;
    }

    this.process = spawn("node", [this.rpcServerPath], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    const rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    rl.on("line", (line) => {
      this.handleResponse(line);
    });

    this.process.on("exit", (code) => {
      console.error(`[aegis-rpc-client] RPC server exited with code ${code}`);
      this.process = null;
      this.ready = false;
    });

    this.process.on("error", (err) => {
      console.error(`[aegis-rpc-client] RPC server error:`, err);
      this.rejectAllPending(err);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.ready = false;
    this.rejectAllPending(new Error("RPC client stopped"));
  }

  private rejectAllPending(error: Error): void {
    for (const [, { reject }] of this.pendingRequests) {
      reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleResponse(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const response = JSON.parse(trimmed) as RpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch {
      // Ignore parse errors (might be log output)
    }
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error("RPC client not started");
    }

    const id = ++this.requestId;
    const request: RpcRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        },
        reject,
      });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  async init(config: {
    config: Record<string, unknown>;
    stateDir: string;
    pluginRootDir: string;
    skillRoots?: string[];
    protectedRoots?: string[];
  }): Promise<void> {
    await this.call("init", config);
    this.ready = true;
    this.flushReadyCallbacks();
  }

  private flushReadyCallbacks(): void {
    for (const cb of this.readyCallbacks) {
      cb();
    }
    this.readyCallbacks = [];
  }

  async whenReady(): Promise<void> {
    if (this.ready) return;
    return new Promise((resolve) => {
      this.readyCallbacks.push(resolve);
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  // Convenience methods for common operations

  async ping(): Promise<{ pong: boolean; initialized: boolean }> {
    return this.call("ping", {}) as Promise<{
      pong: boolean;
      initialized: boolean;
    }>;
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.call("get_config", {}) as Promise<Record<string, unknown>>;
  }

  async checkBeforeTool(params: {
    tool: string;
    args: Record<string, unknown>;
    sessionKey?: string;
    runId?: string;
  }): Promise<{
    block: boolean;
    mode: string;
    defense?: string;
    reason?: string;
    severity?: string;
    details?: Record<string, unknown>;
  }> {
    return this.call("check_before_tool", params) as Promise<{
      block: boolean;
      mode: string;
      defense?: string;
      reason?: string;
      severity?: string;
      details?: Record<string, unknown>;
    }>;
  }

  async checkToolResult(params: {
    tool: string;
    args: Record<string, unknown>;
    result: string;
    sessionKey?: string;
    runId?: string;
  }): Promise<{ riskFlags: string[]; suspicious: boolean }> {
    return this.call("check_tool_result", params) as Promise<{
      riskFlags: string[];
      suspicious: boolean;
    }>;
  }

  async checkUserInput(params: {
    content: string;
    sessionKey?: string;
  }): Promise<{ riskFlags: string[]; context?: string }> {
    return this.call("check_user_input", params) as Promise<{
      riskFlags: string[];
      context?: string;
    }>;
  }

  async getPromptGuard(params: {
    sessionKey?: string;
  }): Promise<{ context: string | null }> {
    return this.call("get_prompt_guard", params) as Promise<{
      context: string | null;
    }>;
  }

  async redactOutput(params: {
    text: string;
    sessionKey?: string;
  }): Promise<{ text: string; redacted: boolean }> {
    return this.call("redact_output", params) as Promise<{
      text: string;
      redacted: boolean;
    }>;
  }

  async updateState(params: {
    method: string;
    sessionKey?: string;
    runId?: string;
    data?: Record<string, unknown>;
  }): Promise<{ ok: true }> {
    return this.call("update_state", params) as Promise<{ ok: true }>;
  }

  async scanSkills(params: { roots: string[] }): Promise<{ scanned: number }> {
    return this.call("scan_skills", params) as Promise<{ scanned: number }>;
  }
}
