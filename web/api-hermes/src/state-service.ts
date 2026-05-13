/**
 * State service for Hermes adapter.
 *
 * Reads state files from the Hermes state directory.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type TrustedSkillInfo = {
  path: string;
  hash: string;
  size: number;
  scannedAt: number;
};

export type SelfIntegrityStatus = {
  valid: boolean;
  protectedRoots: string[];
  fingerprintCount: number;
  updatedAt: number;
} | null;

export type DefenseEvent = {
  timestamp: number;
  defense: string;
  mode: string;
  reason: string;
  severity: string;
  blocked: boolean;
  details?: Record<string, unknown>;
};

const TRUSTED_SKILLS_FILENAME = "trusted-skills.json";
const SELF_INTEGRITY_FILENAME = "self-integrity.json";
const DEFENSE_EVENTS_FILENAME = "defense-events.jsonl";
const SKILL_SCAN_EVENTS_FILENAME = "skill-scan-events.jsonl";

type PersistedTrustedSkillsFile = {
  version: number;
  records: TrustedSkillInfo[];
};

type SelfIntegrityRecord = {
  pluginId: string;
  stateDir: string;
  protectedRoots: string[];
  fingerprints: Record<string, string>;
  updatedAt: number;
};

export class StateService {
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  getStateDir(): string {
    return this.stateDir;
  }

  isConfigured(): boolean {
    return this.stateDir.length > 0;
  }

  getTrustedSkillsPath(): string {
    return path.join(this.stateDir, TRUSTED_SKILLS_FILENAME);
  }

  getSelfIntegrityPath(): string {
    return path.join(this.stateDir, SELF_INTEGRITY_FILENAME);
  }

  getDefenseEventsPath(): string {
    return path.join(this.stateDir, DEFENSE_EVENTS_FILENAME);
  }

  getSkillScanEventsPath(): string {
    return path.join(this.stateDir, SKILL_SCAN_EVENTS_FILENAME);
  }

  async getTrustedSkills(): Promise<TrustedSkillInfo[]> {
    if (!this.isConfigured()) return [];
    try {
      const raw = await fs.readFile(this.getTrustedSkillsPath(), "utf8");
      const parsed = JSON.parse(raw) as PersistedTrustedSkillsFile;
      if (!Array.isArray(parsed?.records)) return [];
      return parsed.records.filter(
        (r) =>
          typeof r.path === "string" &&
          typeof r.hash === "string" &&
          typeof r.size === "number" &&
          typeof r.scannedAt === "number"
      );
    } catch {
      return [];
    }
  }

  async removeTrustedSkill(skillPath: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const raw = await fs.readFile(this.getTrustedSkillsPath(), "utf8");
      const parsed = JSON.parse(raw) as PersistedTrustedSkillsFile;
      if (!Array.isArray(parsed?.records)) return false;

      const normalizedTarget = path.resolve(skillPath);
      const before = parsed.records.length;
      parsed.records = parsed.records.filter(
        (r) => path.resolve(r.path) !== normalizedTarget
      );
      if (parsed.records.length === before) return false;

      const tempPath = `${this.getTrustedSkillsPath()}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(
          tempPath,
          JSON.stringify(parsed, null, 2) + "\n",
          "utf8"
        );
        await fs.rename(tempPath, this.getTrustedSkillsPath());
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getSelfIntegrity(): Promise<SelfIntegrityStatus> {
    if (!this.isConfigured()) return null;
    try {
      const raw = await fs.readFile(this.getSelfIntegrityPath(), "utf8");
      const parsed = JSON.parse(raw) as SelfIntegrityRecord;
      if (
        typeof parsed?.pluginId !== "string" ||
        typeof parsed?.stateDir !== "string" ||
        typeof parsed?.updatedAt !== "number"
      ) {
        return null;
      }
      return {
        valid: true,
        protectedRoots: Array.isArray(parsed.protectedRoots)
          ? parsed.protectedRoots.filter((r): r is string => typeof r === "string")
          : [],
        fingerprintCount: parsed.fingerprints
          ? Object.keys(parsed.fingerprints).length
          : 0,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }

  async getDefenseEvents(options?: {
    limit?: number;
    offset?: number;
    defense?: string;
    result?: "blocked" | "observed" | "clear";
  }): Promise<DefenseEvent[]> {
    if (!this.isConfigured()) return [];
    try {
      const raw = await fs.readFile(this.getDefenseEventsPath(), "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);

      let events: DefenseEvent[] = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as DefenseEvent;
          if (this.matchesFilter(event, options)) {
            events.push(event);
          }
        } catch {
          // Skip invalid lines
        }
      }

      // Sort by timestamp descending
      events.sort((a, b) => b.timestamp - a.timestamp);

      // Apply pagination
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return events.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }

  private matchesFilter(
    event: DefenseEvent,
    filters?: {
      defense?: string;
      result?: "blocked" | "observed" | "clear";
    }
  ): boolean {
    if (filters?.defense && event.defense !== filters.defense) {
      return false;
    }
    if (filters?.result) {
      if (filters.result === "blocked" && !event.blocked) return false;
      if (filters.result === "observed" && (event.blocked || event.mode === "off"))
        return false;
      if (filters.result === "clear" && event.mode !== "off") return false;
    }
    return true;
  }

  async countDefenseEvents(): Promise<number> {
    if (!this.isConfigured()) return 0;
    try {
      const raw = await fs.readFile(this.getDefenseEventsPath(), "utf8");
      return raw.trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  async getSkillScanEvents(options?: {
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    if (!this.isConfigured()) return [];
    try {
      const raw = await fs.readFile(this.getSkillScanEventsPath(), "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);

      let events: unknown[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip invalid lines
        }
      }

      // Sort by timestamp descending
      events.sort((a, b) => {
        const tsA = (a as { timestamp?: number }).timestamp ?? 0;
        const tsB = (b as { timestamp?: number }).timestamp ?? 0;
        return tsB - tsA;
      });

      // Apply pagination
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return events.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }
}
