import { Router } from "express";
import type { StateService } from "../services/state-service.js";
import type { EventService } from "../services/event-service.js";

export function createSkillsRouter(
  stateService: StateService,
  eventService: EventService,
): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const trustedSkills = await stateService.getTrustedSkills();
      res.json({
        ok: true,
        data: { trustedSkills, total: trustedSkills.length },
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:path(*)", async (req, res, next) => {
    try {
      const skillPath = decodeURIComponent((req.params as Record<string, string>)["path(*)"] ?? (req.params as Record<string, string>).path ?? "");
      const removed = await stateService.removeTrustedSkill(skillPath);
      if (removed) {
        eventService.addEvent({
          timestamp: Date.now(),
          defense: "skillScan",
          result: "clear",
          reason: `Trusted skill removed: ${skillPath}`,
        });
      }
      res.json({ ok: true, data: { removed } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
