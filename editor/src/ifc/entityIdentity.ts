import identityAttributes from "./identityAttributes.json";

export function getNativeIdentityAttributeIndexes(entity: { type: string; args: string[] }, schema = "IFC4X3"): { name?: number; description?: number } {
  const schemas = identityAttributes as Record<string, Record<string, number[]>>;
  const version = schema.startsWith("IFC2X3") ? "IFC2X3" : schema.startsWith("IFC4X3") ? "IFC4X3" : "IFC4";
  const indexes = schemas[version]?.[entity.type.toUpperCase()];
  const valid = (index: number | undefined) => index != null && index >= 0 && index < entity.args.length ? index : undefined;
  return { name: valid(indexes?.[0]), description: valid(indexes?.[1]) };
}
