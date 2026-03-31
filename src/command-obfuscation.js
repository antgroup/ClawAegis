const MAX_COMMAND_CHARS = 1e4;
const INVISIBLE_UNICODE_CODE_POINTS = /* @__PURE__ */ new Set([
  173,
  847,
  1564,
  6155,
  6156,
  6157,
  6158,
  6159,
  8203,
  8204,
  8205,
  8206,
  8207,
  8234,
  8235,
  8236,
  8237,
  8238,
  8288,
  8289,
  8290,
  8291,
  8292,
  8294,
  8295,
  8296,
  8297,
  65279
]);
const OBFUSCATION_PATTERNS = [
  { id: "base64-pipe-exec", regex: /base64\s+(?:-d|--decode)\b.*\|\s*(?:sh|bash|zsh|dash|ksh|fish)\b/i },
  { id: "hex-pipe-exec", regex: /xxd\s+-r\b.*\|\s*(?:sh|bash|zsh|dash|ksh|fish)\b/i },
  { id: "printf-pipe-exec", regex: /printf\s+.*\\x[0-9a-f]{2}.*\|\s*(?:sh|bash|zsh|dash|ksh|fish)\b/i },
  { id: "eval-decode", regex: /eval\s+.*(?:base64|xxd|printf|decode|frombase64string)/i },
  { id: "command-substitution-decode-exec", regex: /(?:sh|bash|zsh|dash|ksh|fish)\s+-c\s+["'][^"']*\$\([^)]*(?:base64\s+(?:-d|--decode)|xxd\s+-r|printf\s+.*\\x[0-9a-f]{2})[^)]*\)[^"']*["']/i },
  { id: "process-substitution-remote-exec", regex: /(?:sh|bash|zsh|dash|ksh|fish)\s+<\(\s*(?:curl|wget)\b/i },
  { id: "source-process-substitution-remote", regex: /(?:^|[;&\s])(?:source|\.)\s+<\(\s*(?:curl|wget)\b/i },
  { id: "shell-heredoc-exec", regex: /(?:sh|bash|zsh|dash|ksh|fish)\s+<<-?\s*['"]?[a-zA-Z_][\w-]*['"]?/i },
  { id: "octal-escape", regex: /\$'(?:[^']*\\[0-7]{3}){2,}/ },
  { id: "hex-escape", regex: /\$'(?:[^']*\\x[0-9a-fA-F]{2}){2,}/ },
  { id: "python-exec-encoded", regex: /python[23]?\s+-[ec]\s+.*(?:base64|b64decode|decode|exec|eval)/i },
  { id: "node-exec-encoded", regex: /node\s+-[ec]\s+.*(?:buffer\.from\s*\(.*(?:base64|hex)|atob\s*\(|eval\s*\(|new\s+function)/i },
  { id: "powershell-encoded", regex: /(?:pwsh|powershell)\b.*\s-(?:enc|encodedcommand)\s+[A-Za-z0-9+/=_-]{8,}/i },
  { id: "curl-pipe-shell", regex: /(?:curl|wget)\s+.*\|\s*(?:sh|bash|zsh|dash|ksh|fish)\b/i },
  { id: "var-expansion-obfuscation", regex: /(?:[a-zA-Z_]\w{0,2}=[^;\s]+\s*;\s*){2,}[^$]*\$(?:[a-zA-Z_]|\{[a-zA-Z_])/ }
];
function stripInvisibleUnicode(command) {
  return Array.from(command).filter((char) => !INVISIBLE_UNICODE_CODE_POINTS.has(char.codePointAt(0) ?? -1)).join("");
}
function detectCommandObfuscation(command) {
  if (!command?.trim()) {
    return {
      detected: false,
      matchedPatterns: []
    };
  }
  if (command.length > MAX_COMMAND_CHARS) {
    return {
      detected: true,
      matchedPatterns: ["command-too-long"]
    };
  }
  const normalized = stripInvisibleUnicode(command.normalize("NFKC"));
  const matchedPatterns = OBFUSCATION_PATTERNS.filter((pattern) => pattern.regex.test(normalized)).map(
    (pattern) => pattern.id
  );
  return {
    detected: matchedPatterns.length > 0,
    matchedPatterns
  };
}
export {
  detectCommandObfuscation
};
