import { Router } from "express";
export function createEventsRouter(eventService) {
    const router = Router();
    router.get("/", (_req, res) => {
        const { limit, offset, defense, result } = _req.query;
        const data = eventService.getEvents({
            limit: limit ? parseInt(String(limit), 10) : undefined,
            offset: offset ? parseInt(String(offset), 10) : undefined,
            defense: defense ? String(defense) : undefined,
            result: result ? String(result) : undefined,
        });
        res.json({ ok: true, data });
    });
    return router;
}
//# sourceMappingURL=events.js.map