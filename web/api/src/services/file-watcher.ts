import { watch, type FSWatcher } from "chokidar";
import { promises as fs } from "node:fs";
import { DEFENSE_EVENTS_FILENAME } from "@claw-aegis-web/shared";
import type { SecurityEvent } from "@claw-aegis-web/shared";
import type { ConfigService } from "./config-service.js";
import type { StateService } from "./state-service.js";
import type { EventService } from "./event-service.js";

type RawDefenseEvent = {
  timestamp: number;
  defense: string;
  result: "blocked" | "observed";
  toolName?: string;
  reason?: string;
  details?: Record<string, unknown>;
};

function isValidResult(v: unknown): v is SecurityEvent["result"] {
  return v === "blocked" || v === "observed" || v === "clear";
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private eventsFileOffset = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
    private readonly eventService: EventService,
  ) {}

  async start(): Promise<void> {
    const paths: string[] = [this.configService.getPluginJsonPath()];

    if (this.stateService.isConfigured()) {
      paths.push(
        this.stateService.getTrustedSkillsPath(),
        this.stateService.getSelfIntegrityPath(),
        this.stateService.getDefenseEventsPath(),
      );

      await this.loadExistingEvents();
    }

    this.watcher = watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    this.watcher.on("change", (filePath: string) => {
      const basename = filePath.split("/").pop() ?? "";
      if (basename === "openclaw.plugin.json") {
        this.eventService.addEvent({
          timestamp: Date.now(),
          defense: "config",
          result: "clear",
          reason: "Configuration file changed externally",
        });
      } else if (basename === "trusted-skills.json") {
        this.eventService.addEvent({
          timestamp: Date.now(),
          defense: "skillScan",
          result: "clear",
          reason: "Trusted skills file updated",
        });
      } else if (basename === "self-integrity.json") {
        this.eventService.addEvent({
          timestamp: Date.now(),
          defense: "selfProtection",
          result: "clear",
          reason: "Self-integrity record updated",
        });
      } else if (basename === DEFENSE_EVENTS_FILENAME) {
        this.readNewEvents().catch(() => {});
      }
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private async loadExistingEvents(): Promise<void> {
    const eventsPath = this.stateService.getDefenseEventsPath();
    try {
      const content = await fs.readFile(eventsPath, "utf8");
      this.eventsFileOffset = Buffer.byteLength(content, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      // Load only last 1000 lines
      const recent = lines.slice(-1000);
      for (const line of recent) {
        const event = this.parseLine(line);
        if (event) {
          this.eventService.addEvent(event);
        }
      }
    } catch {
      this.eventsFileOffset = 0;
    }
  }

  private async readNewEvents(): Promise<void> {
    const eventsPath = this.stateService.getDefenseEventsPath();
    try {
      const stat = await fs.stat(eventsPath);
      if (stat.size <= this.eventsFileOffset) return;

      const fd = await fs.open(eventsPath, "r");
      try {
        const buf = Buffer.alloc(stat.size - this.eventsFileOffset);
        await fd.read(buf, 0, buf.length, this.eventsFileOffset);
        this.eventsFileOffset = stat.size;
        const chunk = buf.toString("utf8");
        const lines = chunk.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          const event = this.parseLine(line);
          if (event) {
            this.eventService.addEvent(event);
          }
        }
      } finally {
        await fd.close();
      }
    } catch {
      // ignore read errors
    }
  }

  private parseLine(line: string): Omit<SecurityEvent, "id"> | null {
    try {
      const raw = JSON.parse(line) as RawDefenseEvent;
      if (typeof raw.timestamp !== "number" || typeof raw.defense !== "string" || !isValidResult(raw.result)) {
        return null;
      }
      return {
        timestamp: raw.timestamp,
        defense: raw.defense,
        result: raw.result,
        toolName: raw.toolName,
        reason: raw.reason,
        details: raw.details,
      };
    } catch {
      return null;
    }
  }
}
