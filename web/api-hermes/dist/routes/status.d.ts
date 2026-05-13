import { Router } from "express";
import { ConfigService } from "../config-service.js";
import { StateService } from "../state-service.js";
import { AegisRpcClient } from "../rpc-client.js";
export declare function createStatusRouter(configService: ConfigService, stateService: StateService, rpcClient?: AegisRpcClient): Router;
//# sourceMappingURL=status.d.ts.map