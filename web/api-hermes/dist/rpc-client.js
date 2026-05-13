/**
 * JSON-RPC client for communicating with AegisRpcRuntime.
 *
 * This client spawns the rpc-server.ts as a subprocess and communicates
 * via line-delimited JSON over stdin/stdout.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export class AegisRpcClient {
    process = null;
    requestId = 0;
    pendingRequests = new Map();
    ready = false;
    readyCallbacks = [];
    rpcServerPath;
    constructor(rpcServerPath) {
        // Default to looking for rpc-server.js in the project root
        this.rpcServerPath =
            rpcServerPath ??
                path.resolve(__dirname, "../../../../rpc-server.js");
    }
    start() {
        if (this.process) {
            return;
        }
        this.process = spawn("node", [this.rpcServerPath], {
            stdio: ["pipe", "pipe", "inherit"],
        });
        const rl = createInterface({
            input: this.process.stdout,
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
    stop() {
        if (this.process) {
            this.process.kill("SIGTERM");
            this.process = null;
        }
        this.ready = false;
        this.rejectAllPending(new Error("RPC client stopped"));
    }
    rejectAllPending(error) {
        for (const [, { reject }] of this.pendingRequests) {
            reject(error);
        }
        this.pendingRequests.clear();
    }
    handleResponse(line) {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        try {
            const response = JSON.parse(trimmed);
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                this.pendingRequests.delete(response.id);
                pending.resolve(response);
            }
        }
        catch {
            // Ignore parse errors (might be log output)
        }
    }
    async call(method, params) {
        if (!this.process?.stdin) {
            throw new Error("RPC client not started");
        }
        const id = ++this.requestId;
        const request = { id, method, params };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve: (response) => {
                    if (response.error) {
                        reject(new Error(response.error.message));
                    }
                    else {
                        resolve(response.result);
                    }
                },
                reject,
            });
            this.process.stdin.write(JSON.stringify(request) + "\n");
        });
    }
    async init(config) {
        await this.call("init", config);
        this.ready = true;
        this.flushReadyCallbacks();
    }
    flushReadyCallbacks() {
        for (const cb of this.readyCallbacks) {
            cb();
        }
        this.readyCallbacks = [];
    }
    async whenReady() {
        if (this.ready)
            return;
        return new Promise((resolve) => {
            this.readyCallbacks.push(resolve);
        });
    }
    isReady() {
        return this.ready;
    }
    // Convenience methods for common operations
    async ping() {
        return this.call("ping", {});
    }
    async getConfig() {
        return this.call("get_config", {});
    }
    async checkBeforeTool(params) {
        return this.call("check_before_tool", params);
    }
    async checkToolResult(params) {
        return this.call("check_tool_result", params);
    }
    async checkUserInput(params) {
        return this.call("check_user_input", params);
    }
    async getPromptGuard(params) {
        return this.call("get_prompt_guard", params);
    }
    async redactOutput(params) {
        return this.call("redact_output", params);
    }
    async updateState(params) {
        return this.call("update_state", params);
    }
    async scanSkills(params) {
        return this.call("scan_skills", params);
    }
}
//# sourceMappingURL=rpc-client.js.map