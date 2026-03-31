import type { OpenClawPluginApi, OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/core";

export type { OpenClawPluginApi, OpenClawPluginConfigSchema };

export type PluginHookMessageContext = {
  sessionKey?: string;
  runId?: string;
  [key: string]: unknown;
};

export type PluginHookGatewayStartEvent = Record<string, never>;

export type PluginHookMessageReceivedEvent = {
  content?: string;
  [key: string]: unknown;
};

export type PluginHookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type PluginHookMessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

export type PluginHookBeforePromptBuildEvent = {
  prompt?: string;
  messages?: unknown[];
  [key: string]: unknown;
};

export type PluginHookBeforePromptBuildResult = {
  prependContext?: string;
  appendContext?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
};

export type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params?: Record<string, unknown>;
};

export type PluginHookBeforeToolCallResult = {
  block?: boolean;
  blockReason?: string;
};

export type PluginHookAfterToolCallEvent = {
  toolName: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  [key: string]: unknown;
};

export type PluginHookBeforeMessageWriteEvent = {
  message: Record<string, unknown>;
};

export type PluginHookBeforeMessageWriteResult = {
  block?: boolean;
  message?: Record<string, unknown>;
};

export type PluginHookAgentEndEvent = {
  messages?: unknown[];
  success?: boolean;
  error?: string;
  durationMs?: number;
  [key: string]: unknown;
};

export type PluginHookSessionEndEvent = {
  sessionId?: string;
  sessionKey?: string;
  messageCount?: number;
  durationMs?: number;
  [key: string]: unknown;
};

type CompatiblePluginKind = "memory" | "context-engine";

type CompatiblePluginEntry = {
  id: string;
  name: string;
  description: string;
  kind?: CompatiblePluginKind;
  configSchema?: OpenClawPluginConfigSchema;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
};

type DefinePluginEntryOptions = CompatiblePluginEntry & {
  configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
};

function resolvePluginConfigSchema(
  configSchema: DefinePluginEntryOptions["configSchema"],
): OpenClawPluginConfigSchema | undefined {
  if (!configSchema) {
    return undefined;
  }
  return typeof configSchema === "function" ? configSchema() : configSchema;
}

// Keep the plugin entry helper local so third-party installs do not depend on
// specific OpenClaw SDK subpaths being present at runtime.
export function definePluginEntry({
  id,
  name,
  description,
  kind,
  configSchema,
  register,
}: DefinePluginEntryOptions): CompatiblePluginEntry {
  const resolvedConfigSchema = resolvePluginConfigSchema(configSchema);
  return {
    id,
    name,
    description,
    ...(kind ? { kind } : {}),
    ...(resolvedConfigSchema ? { configSchema: resolvedConfigSchema } : {}),
    register,
  };
}
