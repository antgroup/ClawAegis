import { watch } from "chokidar";
export class FileWatcher {
    configService;
    stateService;
    eventService;
    watcher = null;
    constructor(configService, stateService, eventService) {
        this.configService = configService;
        this.stateService = stateService;
        this.eventService = eventService;
    }
    start() {
        const paths = [this.configService.getPluginJsonPath()];
        if (this.stateService.isConfigured()) {
            paths.push(this.stateService.getTrustedSkillsPath(), this.stateService.getSelfIntegrityPath());
        }
        this.watcher = watch(paths, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300 },
        });
        this.watcher.on("change", (filePath) => {
            const basename = filePath.split("/").pop() ?? "";
            if (basename === "openclaw.plugin.json") {
                this.eventService.addEvent({
                    timestamp: Date.now(),
                    defense: "config",
                    result: "clear",
                    reason: "Configuration file changed externally",
                });
            }
            else if (basename === "trusted-skills.json") {
                this.eventService.addEvent({
                    timestamp: Date.now(),
                    defense: "skillScan",
                    result: "clear",
                    reason: "Trusted skills file updated",
                });
            }
            else if (basename === "self-integrity.json") {
                this.eventService.addEvent({
                    timestamp: Date.now(),
                    defense: "selfProtection",
                    result: "clear",
                    reason: "Self-integrity record updated",
                });
            }
        });
    }
    stop() {
        this.watcher?.close();
        this.watcher = null;
    }
}
//# sourceMappingURL=file-watcher.js.map