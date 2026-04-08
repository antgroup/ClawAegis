import { watch, type FSWatcher } from "chokidar";
import type { ConfigService } from "./config-service.js";
import type { StateService } from "./state-service.js";
import type { EventService } from "./event-service.js";

export class FileWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
    private readonly eventService: EventService,
  ) {}

  start(): void {
    const paths: string[] = [this.configService.getPluginJsonPath()];

    if (this.stateService.isConfigured()) {
      paths.push(
        this.stateService.getTrustedSkillsPath(),
        this.stateService.getSelfIntegrityPath(),
      );
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
      }
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
