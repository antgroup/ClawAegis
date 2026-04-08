const MAX_EVENTS = 1000;
export class EventService {
    events = [];
    nextId = 1;
    listeners = new Set();
    addEvent(event) {
        const full = {
            ...event,
            id: String(this.nextId++),
        };
        this.events.push(full);
        if (this.events.length > MAX_EVENTS) {
            this.events.splice(0, this.events.length - MAX_EVENTS);
        }
        for (const listener of this.listeners) {
            listener(full);
        }
        return full;
    }
    getEvents(params) {
        let filtered = this.events;
        if (params?.defense) {
            filtered = filtered.filter((e) => e.defense === params.defense);
        }
        if (params?.result) {
            filtered = filtered.filter((e) => e.result === params.result);
        }
        const total = filtered.length;
        const offset = params?.offset ?? 0;
        const limit = params?.limit ?? 50;
        // Return newest first
        const sorted = [...filtered].reverse();
        const sliced = sorted.slice(offset, offset + limit);
        return { events: sliced, total };
    }
    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
//# sourceMappingURL=event-service.js.map