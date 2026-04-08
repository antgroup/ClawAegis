export const API_PREFIX = "/api/v1";

export const DEFENSE_MODES = ["off", "observe", "enforce"] as const;
export type DefenseMode = (typeof DEFENSE_MODES)[number];

export const TRUSTED_SKILLS_FILENAME = "trusted-skills.json";
export const SELF_INTEGRITY_FILENAME = "self-integrity.json";
