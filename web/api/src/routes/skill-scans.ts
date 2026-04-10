import { Router } from "express";
import type { SkillScanEventService } from "../services/skill-scan-event-service.js";

export function createSkillScansRouter(
  skillScanEventService: SkillScanEventService,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const params = {
      limit: _req.query.limit ? Number(_req.query.limit) : undefined,
      offset: _req.query.offset ? Number(_req.query.offset) : undefined,
      trusted: typeof _req.query.trusted === "string" ? _req.query.trusted : undefined,
    };
    const result = skillScanEventService.getEvents(params);
    res.json({ ok: true, data: result });
  });

  return router;
}
