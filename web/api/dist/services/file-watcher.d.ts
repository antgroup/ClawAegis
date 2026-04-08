import type { ConfigService } from "./config-service.js";
import type { StateService } from "./state-service.js";
import type { EventService } from "./event-service.js";
export declare class FileWatcher {
    private readonly configService;
    private readonly stateService;
    private readonly eventService;
    private watcher;
    constructor(configService: ConfigService, stateService: StateService, eventService: EventService);
    start(): void;
    stop(): void;
}
//# sourceMappingURL=file-watcher.d.ts.map