import { createHash } from "node:crypto";

export const MAX_SCAN_TEXT_CHARS = 10_000;
export const MAX_CANDIDATES_PER_TEXT = 32;
export const MAX_CANDIDATE_CHARS = 2_048;
export const MAX_DECODE_DEPTH = 2;
export const MAX_DECODE_OUTPUT_BYTES = 4_096;

export type EncodedCandidateKind = "base64" | "base64url" | "base32" | "hex" | "url";

export type EncodedCandidateFinding = {
  kind: EncodedCandidateKind;
  tokenHash: string;
  decodedHash: string;
  decodedPreview: string;
  decodedLength: number;
  riskFlags: string[];
  confidence: "medium" | "high";
};

export type EncodedInspectionResult = {
  findings: EncodedCandidateFinding[];
  degraded: boolean;
  errorCount: number;
  scannedChars: number;
  candidateCount: number;
};

type EncodedCandidate = {
  kind: EncodedCandidateKind;
  token: string;
};

type InspectEncodedCandidateOptions = {
  analyzeDecoded?: (decoded: string, kind: EncodedCandidateKind) => string[];
  maxScanChars?: number;
  maxCandidates?: number;
};

type SanitizedEncodedSecretsResult = {
  value: string;
  changed: boolean;
  redactionCount: number;
};

type CandidateInspectionOutcome = {
  finding?: EncodedCandidateFinding;
  degraded: boolean;
  errorCount: number;
};

const TOKEN_BREAK_CHARS = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  '"',
  "'",
  "`",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  ":",
  "=",
  "<",
  ">",
]);

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_TOTAL_DECODE_BYTES = MAX_DECODE_DEPTH * MAX_DECODE_OUTPUT_BYTES;

function shortenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isTokenBreakChar(char: string): boolean {
  return TOKEN_BREAK_CHARS.has(char);
}

function shouldKeepCandidateChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x21 && code <= 0x7e;
}

function buildScanWindows(text: string, maxScanChars: number): {
  windows: string[];
  degraded: boolean;
  scannedChars: number;
} {
  if (text.length <= maxScanChars) {
    return {
      windows: [text],
      degraded: false,
      scannedChars: text.length,
    };
  }
  const half = Math.floor(maxScanChars / 2);
  const first = text.slice(0, half);
  const last = text.slice(-half);
  return {
    windows: [first, last],
    degraded: true,
    scannedChars: first.length + last.length,
  };
}

function extractCandidateTokens(text: string, maxCandidates: number): {
  candidates: string[];
  degraded: boolean;
} {
  const candidates: string[] = [];
  const seen = new Set<string>();
  let degraded = false;
  let current = "";

  const flush = () => {
    const candidate = current.trim();
    current = "";
    if (!candidate) {
      return;
    }
    if (candidate.length > MAX_CANDIDATE_CHARS) {
      degraded = true;
      return;
    }
    if (seen.has(candidate)) {
      return;
    }
    if (candidates.length >= maxCandidates) {
      degraded = true;
      return;
    }
    seen.add(candidate);
    candidates.push(candidate);
  };

  for (const char of text) {
    if (isTokenBreakChar(char) || !shouldKeepCandidateChar(char)) {
      flush();
      continue;
    }
    current += char;
    if (current.length > MAX_CANDIDATE_CHARS) {
      flush();
      degraded = true;
    }
  }
  flush();
  return { candidates, degraded };
}

function isHexChar(char: string): boolean {
  return (
    (char >= "0" && char <= "9") ||
    (char >= "a" && char <= "f") ||
    (char >= "A" && char <= "F")
  );
}

function isBase64Char(char: string): boolean {
  return (
    (char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "+" ||
    char === "/" ||
    char === "="
  );
}

function isBase64UrlChar(char: string): boolean {
  return (
    (char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "-" ||
    char === "_" ||
    char === "="
  );
}

function isBase32Char(char: string): boolean {
  const upper = char.toUpperCase();
  return (upper >= "A" && upper <= "Z") || (char >= "2" && char <= "7") || char === "=";
}

function hasRepeatedPercentEncoding(token: string): boolean {
  let pairs = 0;
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "%") {
      continue;
    }
    const first = token[index + 1];
    const second = token[index + 2];
    if (!first || !second || !isHexChar(first) || !isHexChar(second)) {
      return false;
    }
    pairs += 1;
    index += 2;
  }
  return pairs >= 2;
}

function looksLikeUrlEncodedToken(token: string): boolean {
  return token.length >= 6 && token.length <= MAX_CANDIDATE_CHARS && hasRepeatedPercentEncoding(token);
}

function looksLikeHexToken(token: string): boolean {
  if (token.length < 16 || token.length > MAX_CANDIDATE_CHARS || token.length % 2 !== 0) {
    return false;
  }
  for (const char of token) {
    if (!isHexChar(char)) {
      return false;
    }
  }
  return true;
}

function looksLikeBase32Token(token: string): boolean {
  if (token.length < 16 || token.length > MAX_CANDIDATE_CHARS) {
    return false;
  }
  let digitCount = 0;
  for (const char of token) {
    if (!isBase32Char(char)) {
      return false;
    }
    if (char >= "2" && char <= "7") {
      digitCount += 1;
    }
  }
  return digitCount > 0;
}

function looksLikeBase64Token(token: string): boolean {
  if (token.length < 16 || token.length > MAX_CANDIDATE_CHARS) {
    return false;
  }
  let specialCount = 0;
  for (const char of token) {
    if (!isBase64Char(char)) {
      return false;
    }
    if (char === "+" || char === "/" || char === "=") {
      specialCount += 1;
    }
  }
  return specialCount > 0 || /[a-z]/.test(token);
}

function looksLikeBase64UrlToken(token: string): boolean {
  if (token.length < 16 || token.length > MAX_CANDIDATE_CHARS) {
    return false;
  }
  let specialCount = 0;
  for (const char of token) {
    if (!isBase64UrlChar(char)) {
      return false;
    }
    if (char === "-" || char === "_" || char === "=") {
      specialCount += 1;
    }
  }
  return specialCount > 0;
}

function detectCandidateKind(token: string): EncodedCandidateKind | undefined {
  if (looksLikeUrlEncodedToken(token)) {
    return "url";
  }
  if (looksLikeHexToken(token)) {
    return "hex";
  }
  if (looksLikeBase32Token(token)) {
    return "base32";
  }
  if (looksLikeBase64UrlToken(token)) {
    return "base64url";
  }
  if (looksLikeBase64Token(token)) {
    return "base64";
  }
  return undefined;
}

function utf8BufferLooksTextual(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.length > MAX_DECODE_OUTPUT_BYTES) {
    return false;
  }
  const text = buffer.toString("utf8");
  if (!text.trim() || text.includes("\uFFFD")) {
    return false;
  }
  let printable = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e)) {
      printable += 1;
    }
  }
  return printable / text.length >= 0.7;
}

function safeDecodeUrlToken(token: string): string | undefined {
  try {
    const decoded = decodeURIComponent(token.replaceAll("+", "%20"));
    const normalized = normalizeWhitespace(decoded);
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

function safeDecodeHexToken(token: string): string | undefined {
  if (!looksLikeHexToken(token)) {
    return undefined;
  }
  const bytes = Buffer.alloc(token.length / 2);
  for (let index = 0; index < token.length; index += 2) {
    const parsed = Number.parseInt(token.slice(index, index + 2), 16);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    bytes[index / 2] = parsed;
  }
  if (!utf8BufferLooksTextual(bytes)) {
    return undefined;
  }
  return normalizeWhitespace(bytes.toString("utf8")) || undefined;
}

function safeDecodeBase64Token(token: string): string | undefined {
  const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4 || 4)) % 4), "=");
  try {
    const buffer = Buffer.from(padded, "base64");
    if (!utf8BufferLooksTextual(buffer)) {
      return undefined;
    }
    return normalizeWhitespace(buffer.toString("utf8")) || undefined;
  } catch {
    return undefined;
  }
}

function safeDecodeBase32Token(token: string): string | undefined {
  const normalized = token.toUpperCase().replaceAll("=", "");
  if (!normalized || normalized.length > MAX_CANDIDATE_CHARS) {
    return undefined;
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      return undefined;
    }
    value = (value << 5) | index;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      if (bytes.length > MAX_DECODE_OUTPUT_BYTES) {
        return undefined;
      }
    }
  }
  const buffer = Buffer.from(bytes);
  if (!utf8BufferLooksTextual(buffer)) {
    return undefined;
  }
  return normalizeWhitespace(buffer.toString("utf8")) || undefined;
}

function safeDecodeCandidate(token: string, kind: EncodedCandidateKind): string | undefined {
  switch (kind) {
    case "url":
      return safeDecodeUrlToken(token);
    case "hex":
      return safeDecodeHexToken(token);
    case "base32":
      return safeDecodeBase32Token(token);
    case "base64":
    case "base64url":
      return safeDecodeBase64Token(token);
    default:
      return undefined;
  }
}

function candidateConfidence(riskFlags: string[]): "medium" | "high" {
  return riskFlags.length >= 2 ? "high" : "medium";
}

function inspectDecodedCandidate(params: {
  token: string;
  kind: EncodedCandidateKind;
  rootToken: string;
  analyzeDecoded?: (decoded: string, kind: EncodedCandidateKind) => string[];
  depth: number;
  remainingBytes: number;
  seen: Set<string>;
}): CandidateInspectionOutcome {
  if (params.depth > MAX_DECODE_DEPTH || params.remainingBytes <= 0) {
    return {
      degraded: true,
      errorCount: 0,
    };
  }

  const visitKey = `${params.kind}:${params.token}`;
  if (params.seen.has(visitKey)) {
    return {
      degraded: true,
      errorCount: 0,
    };
  }
  params.seen.add(visitKey);

  let decoded: string | undefined;
  try {
    decoded = safeDecodeCandidate(params.token, params.kind);
  } catch {
    return {
      degraded: true,
      errorCount: 1,
    };
  }
  if (!decoded) {
    return {
      degraded: false,
      errorCount: 0,
    };
  }

  const decodedBytes = Buffer.byteLength(decoded, "utf8");
  if (decodedBytes > params.remainingBytes) {
    return {
      degraded: true,
      errorCount: 0,
    };
  }

  let riskFlags: string[] = [];
  try {
    riskFlags = [...new Set(params.analyzeDecoded?.(decoded, params.kind) ?? [])];
  } catch {
    return {
      degraded: true,
      errorCount: 1,
    };
  }

  if (riskFlags.length > 0) {
    return {
      finding: {
        kind: params.kind,
        tokenHash: shortenHash(params.rootToken),
        decodedHash: shortenHash(decoded),
        decodedPreview: decoded.slice(0, 120),
        decodedLength: decoded.length,
        riskFlags,
        confidence: candidateConfidence(riskFlags),
      },
      degraded: false,
      errorCount: 0,
    };
  }

  if (params.depth >= MAX_DECODE_DEPTH || decoded.length > MAX_CANDIDATE_CHARS || decoded === params.token) {
    return {
      degraded: false,
      errorCount: 0,
    };
  }

  const nestedKind = detectCandidateKind(decoded);
  if (!nestedKind) {
    return {
      degraded: false,
      errorCount: 0,
    };
  }

  return inspectDecodedCandidate({
    token: decoded,
    kind: nestedKind,
    rootToken: params.rootToken,
    analyzeDecoded: params.analyzeDecoded,
    depth: params.depth + 1,
    remainingBytes: params.remainingBytes - decodedBytes,
    seen: params.seen,
  });
}

export function inspectEncodedCandidates(
  text: string,
  options: InspectEncodedCandidateOptions = {},
): EncodedInspectionResult {
  try {
    const maxScanChars = options.maxScanChars ?? MAX_SCAN_TEXT_CHARS;
    const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES_PER_TEXT;
    const windows = buildScanWindows(text, maxScanChars);
    const seenTokens = new Set<string>();
    const candidates: EncodedCandidate[] = [];
    let degraded = windows.degraded;
    let errorCount = 0;

    for (const windowText of windows.windows) {
      const extracted = extractCandidateTokens(windowText, maxCandidates);
      degraded = degraded || extracted.degraded;
      for (const token of extracted.candidates) {
        if (seenTokens.has(token)) {
          continue;
        }
        seenTokens.add(token);
        const kind = detectCandidateKind(token);
        if (!kind) {
          continue;
        }
        if (candidates.length >= maxCandidates) {
          degraded = true;
          break;
        }
        candidates.push({ kind, token });
      }
    }

    const findings: EncodedCandidateFinding[] = [];
    for (const candidate of candidates.slice(0, maxCandidates)) {
      const outcome = inspectDecodedCandidate({
        token: candidate.token,
        kind: candidate.kind,
        rootToken: candidate.token,
        analyzeDecoded: options.analyzeDecoded,
        depth: 1,
        remainingBytes: MAX_TOTAL_DECODE_BYTES,
        seen: new Set<string>(),
      });
      errorCount += outcome.errorCount;
      degraded = degraded || outcome.degraded;
      if (outcome.finding) {
        findings.push(outcome.finding);
      }
    }

    return {
      findings,
      degraded: degraded || errorCount > 0,
      errorCount,
      scannedChars: windows.scannedChars,
      candidateCount: candidates.length,
    };
  } catch {
    return {
      findings: [],
      degraded: true,
      errorCount: 1,
      scannedChars: Math.min(text.length, options.maxScanChars ?? MAX_SCAN_TEXT_CHARS),
      candidateCount: 0,
    };
  }
}

function encodeBase32Bytes(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f] ?? "";
  }
  return output;
}

export function buildObservedSecretVariants(secret: string): string[] {
  const trimmed = secret.trim();
  if (!trimmed || trimmed.length < 8 || trimmed.length > 256) {
    return [];
  }
  const buffer = Buffer.from(trimmed, "utf8");
  const variants = new Set<string>([
    trimmed,
    buffer.toString("base64"),
    buffer.toString("base64url"),
    buffer.toString("hex"),
    encodeBase32Bytes(buffer),
  ]);
  return [...variants].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export function collectObservedSecretVariantMatches(
  text: string,
  observedSecrets: string[],
): string[] {
  if (!text) {
    return [];
  }
  const matches = new Set<string>();
  for (const secret of observedSecrets.slice(0, 16)) {
    for (const variant of buildObservedSecretVariants(secret)) {
      if (variant.length < 8) {
        continue;
      }
      if (text.includes(variant)) {
        matches.add(variant);
      }
    }
  }
  return [...matches].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export function sanitizeEncodedSecretVariants(
  text: string,
  observedSecrets: string[],
  replacement: string,
): SanitizedEncodedSecretsResult {
  if (!text) {
    return {
      value: text,
      changed: false,
      redactionCount: 0,
    };
  }
  const matches = collectObservedSecretVariantMatches(text, observedSecrets);
  if (matches.length === 0) {
    return {
      value: text,
      changed: false,
      redactionCount: 0,
    };
  }

  let next = text;
  let redactionCount = 0;
  for (const match of matches) {
    if (!next.includes(match)) {
      continue;
    }
    const count = next.split(match).length - 1;
    if (count <= 0) {
      continue;
    }
    next = next.split(match).join(replacement);
    redactionCount += count;
  }
  return {
    value: next,
    changed: next !== text,
    redactionCount,
  };
}
