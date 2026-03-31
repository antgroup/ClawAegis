import { parentPort } from "node:worker_threads";
import { inspectEncodedCandidates } from "./encoding-guard.js";
import {
  buildGuardTextVariants,
  matchesPatternRiskRule,
  matchesVariantPatterns,
} from "./rules.js";
import {
  SKILL_SCAN_REMOTE_BOOTSTRAP_RULES,
  SKILL_SCAN_RULES,
  SKILL_SCAN_SAFE_EXAMPLE_PATTERNS,
  type PatternRiskRule,
  type SkillScanBootstrapRule,
} from "./security-strategies.js";
import type { SkillScanRequest, SkillScanResult } from "./types.js";

function splitSkillTextLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasSafeExampleContext(text: string): boolean {
  const variants = buildGuardTextVariants(text);
  return SKILL_SCAN_SAFE_EXAMPLE_PATTERNS.some(
    (pattern) => pattern.test(variants.raw) || pattern.test(variants.normalized),
  );
}

function matchesUnsafeLine(
  lines: string[],
  patterns: readonly RegExp[],
  compactPatterns: readonly RegExp[] = [],
): boolean {
  return lines.some((line) => {
    if (hasSafeExampleContext(line)) {
      return false;
    }
    return matchesVariantPatterns(buildGuardTextVariants(line), patterns, compactPatterns);
  });
}

function matchesSkillRule(
  text: string,
  lines: string[],
  rule: PatternRiskRule,
): boolean {
  if (rule.lineScope === "unsafe_only") {
    return matchesUnsafeLine(lines, rule.patterns, rule.compactPatterns ?? []);
  }
  return matchesPatternRiskRule(buildGuardTextVariants(text), rule);
}

function matchesBootstrapRule(text: string, lines: string[], rule: SkillScanBootstrapRule): boolean {
  if (matchesUnsafeLine(lines, rule.directExecutionPatterns)) {
    return true;
  }
  const hasUnsafeDownload = matchesUnsafeLine(lines, rule.downloadPatterns);
  const hasUnsafeExecution = matchesUnsafeLine(lines, rule.executionPatterns);
  if (hasUnsafeDownload && hasUnsafeExecution) {
    return true;
  }
  return (
    rule.downloadPatterns.some((pattern) => pattern.test(text)) &&
    rule.executionPatterns.some((pattern) => pattern.test(text)) &&
    !hasSafeExampleContext(text)
  );
}

function collectBaseSkillFindings(text: string): string[] {
  const findings = new Set<string>();
  const lines = splitSkillTextLines(text);

  for (const rule of SKILL_SCAN_RULES) {
    if (matchesSkillRule(text, lines, rule)) {
      findings.add(rule.flag);
    }
  }

  for (const rule of SKILL_SCAN_REMOTE_BOOTSTRAP_RULES) {
    if (matchesBootstrapRule(text, lines, rule)) {
      findings.add(rule.flag);
    }
  }

  return [...findings];
}

function analyzeDecodedSkillText(decoded: string): string[] {
  return collectBaseSkillFindings(decoded).map((finding) => `encoded-${finding}`);
}

export function scanSkillText(text: string): SkillScanResult {
  const findings = new Set<string>(collectBaseSkillFindings(text));
  const encodedInspection = inspectEncodedCandidates(text, {
    analyzeDecoded: analyzeDecodedSkillText,
  });
  for (const finding of encodedInspection.findings) {
    for (const riskFlag of finding.riskFlags) {
      findings.add(riskFlag);
    }
  }
  return {
    trusted: findings.size === 0,
    findings: [...findings],
  };
}

if (parentPort) {
  parentPort.on("message", (request: SkillScanRequest) => {
    try {
      const result = scanSkillText(request.text);
      parentPort.postMessage({
        requestId: request.requestId,
        result,
      });
    } catch (error) {
      parentPort.postMessage({
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
