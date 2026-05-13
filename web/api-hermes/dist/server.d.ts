import { AegisRpcClient } from "./rpc-client.js";
export type ServerOptions = {
    port: number;
    configDir: string;
    stateDir: string;
    rpcServerPath?: string;
    staticDir?: string;
};
export declare function createServer(options: ServerOptions): {
    app: import("express-serve-static-core").Express;
    cleanup: () => void;
    rpcClient: AegisRpcClient;
};
//# sourceMappingURL=server.d.ts.map