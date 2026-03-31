function resolvePluginConfigSchema(configSchema) {
  if (!configSchema) {
    return void 0;
  }
  return typeof configSchema === "function" ? configSchema() : configSchema;
}
function definePluginEntry({
  id,
  name,
  description,
  kind,
  configSchema,
  register
}) {
  const resolvedConfigSchema = resolvePluginConfigSchema(configSchema);
  return {
    id,
    name,
    description,
    ...kind ? { kind } : {},
    ...resolvedConfigSchema ? { configSchema: resolvedConfigSchema } : {},
    register
  };
}
export {
  definePluginEntry
};
