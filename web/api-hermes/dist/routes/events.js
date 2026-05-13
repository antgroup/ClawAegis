import { Router } from "express";
function generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
function mapToSecurityEvent(event) {
    // Map mode/blocked to result
    let result;
    if (event.blocked) {
        result = "blocked";
    }
    else if (event.mode === "off") {
        result = "clear";
    }
    else {
        result = "observed";
    }
    return {
        id: generateEventId(),
        timestamp: event.timestamp,
        defense: event.defense,
        result,
        reason: event.reason,
        details: event.details,
        // Extract additional fields from details if available
        toolName: event.details?.tool,
        commandText: event.details?.command,
        toolParams: event.details?.args,
    };
}
export function createEventsRouter(stateService) {
    const router = Router();
    // GET /api/v1/events - Get defense events with optional filtering
    router.get("/", async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            const defense = req.query.defense;
            const result = req.query.result;
            const rawEvents = await stateService.getDefenseEvents({
                limit: limit + offset, // Get enough events to apply offset
                defense,
                result,
            });
            // Map to frontend format and apply offset
            const events = rawEvents.slice(offset, offset + limit).map(mapToSecurityEvent);
            const total = await stateService.countDefenseEvents();
            res.json({
                ok: true,
                data: { events, total },
            });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/events/summary - Get event summary statistics
    router.get("/summary", async (_req, res, next) => {
        try {
            const [blocked, observed] = await Promise.all([
                stateService.getDefenseEvents({ result: "blocked", limit: 1000 }),
                stateService.getDefenseEvents({ result: "observed", limit: 1000 }),
            ]);
            // Group by defense type
            const blockedByDefense = groupByDefense(blocked);
            const observedByDefense = groupByDefense(observed);
            res.json({
                ok: true,
                data: {
                    total: {
                        blocked: blocked.length,
                        observed: observed.length,
                    },
                    byDefense: {
                        blocked: blockedByDefense,
                        observed: observedByDefense,
                    },
                },
            });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/events/defenses - Get list of defense types
    router.get("/defenses", async (_req, res, next) => {
        try {
            const events = await stateService.getDefenseEvents({ limit: 10000 });
            const defenseTypes = [...new Set(events.map((e) => e.defense))];
            res.json({
                ok: true,
                data: defenseTypes,
            });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
function groupByDefense(events) {
    const grouped = {};
    for (const event of events) {
        grouped[event.defense] = (grouped[event.defense] || 0) + 1;
    }
    return grouped;
}
//# sourceMappingURL=events.js.map