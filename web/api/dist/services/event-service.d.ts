import type { SecurityEvent } from "@claw-aegis-web/shared";
export declare class EventService {
    private readonly events;
    private nextId;
    private readonly listeners;
    addEvent(event: Omit<SecurityEvent, "id">): SecurityEvent;
    getEvents(params?: {
        limit?: number;
        offset?: number;
        defense?: string;
        result?: string;
    }): {
        events: SecurityEvent[];
        total: number;
    };
    onEvent(listener: (event: SecurityEvent) => void): () => void;
}
//# sourceMappingURL=event-service.d.ts.map