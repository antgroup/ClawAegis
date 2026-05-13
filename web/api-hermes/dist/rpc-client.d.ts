/**
 * JSON-RPC client for communicating with AegisRpcRuntime.
 *
 * This client spawns the rpc-server.ts as a subprocess and communicates
 * via line-delimited JSON over stdin/stdout.
 */
export type RpcRequest = {
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
};
export type RpcResponse = {
    id: number | string;
    result?: unknown;
    error?: {
        message: string;
        code?: number;
    };
};
export declare class AegisRpcClient {
    private process;
    private requestId;
    private pendingRequests;
    private ready;
    private readyCallbacks;
    private rpcServerPath;
    constructor(rpcServerPath?: string);
    start(): void;
    stop(): void;
    private rejectAllPending;
    private handleResponse;
    call(method: string, params?: Record<string, unknown>): Promise<unknown>;
    init(config: {
        config: Record<string, unknown>;
        stateDir: string;
        pluginRootDir: string;
        skillRoots?: string[];
        protectedRoots?: string[];
    }): Promise<void>;
    private flushReadyCallbacks;
    whenReady(): Promise<void>;
    isReady(): boolean;
    ping(): Promise<{
        pong: boolean;
        initialized: boolean;
    }>;
    getConfig(): Promise<Record<string, unknown>>;
    checkBeforeTool(params: {
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
    }>;
    checkToolResult(params: {
        tool: string;
        args: Record<string, unknown>;
        result: string;
        sessionKey?: string;
        runId?: string;
    }): Promise<{
        riskFlags: string[];
        suspicious: boolean;
    }>;
    checkUserInput(params: {
        content: string;
        sessionKey?: string;
    }): Promise<{
        riskFlags: string[];
        context?: string;
    }>;
    getPromptGuard(params: {
        sessionKey?: string;
    }): Promise<{
        context: string | null;
    }>;
    redactOutput(params: {
        text: string;
        sessionKey?: string;
    }): Promise<{
        text: string;
        redacted: boolean;
    }>;
    updateState(params: {
        method: string;
        sessionKey?: string;
        runId?: string;
        data?: Record<string, unknown>;
    }): Promise<{
        ok: true;
    }>;
    scanSkills(params: {
        roots: string[];
    }): Promise<{
        scanned: number;
    }>;
}
//# sourceMappingURL=rpc-client.d.ts.map