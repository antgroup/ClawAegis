import { Router } from "express";
import { StateService } from "../state-service.js";

type SecurityEvent = {
  id: string;
  timestamp: number;
  defense: string;
  result: "blocked" | "observed" | "clear";
  toolName?: string;
  reason?: string;
  details?: Record<string, unknown>;
  commandText?: string;
  toolParams?: Record<string, unknown>;
  userInput?: string;
};

function generateEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function mapToSecurityEvent(event: {
  timestamp: number;
  defense: string;
  mode: string;
  reason: string;
  severity: string;
  blocked: boolean;
  details?: Record<string, unknown>;
}): SecurityEvent {
  // Map mode/blocked to result
  let result: "blocked" | "observed" | "clear";
  if (event.blocked) {
    result = "blocked";
  } else if (event.mode === "off") {
    result = "clear";
  } else {
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
    toolName: event.details?.tool as string | undefined,
    commandText: event.details?.command as string | undefined,
    toolParams: event.details?.args as Record<string, unknown> | undefined,
  };
}

export function createEventsRouter(stateService: StateService): Router {
  const router = Router();

  // GET /api/v1/events - Get defense events with optional filtering
  router.get("/", async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const defense = req.query.defense as string | undefined;
      const result = req.query.result as "blocked" | "observed" | "clear" | undefined;

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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function groupByDefense(
  events: { defense: string }[]
): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const event of events) {
    grouped[event.defense] = (grouped[event.defense] || 0) + 1;
  }
  return grouped;
}
