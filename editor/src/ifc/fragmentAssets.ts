export function resolveIfcPublicAssetUrl(assetPath: string) {
  const cleanPath = assetPath.replace(/^\/+/, "");
  const location = globalThis.location;
  if (!location) {
    return `/${cleanPath}`;
  }
  if (location.protocol === "file:") {
    return new URL(cleanPath, location.href).toString();
  }
  return new URL(cleanPath, `${location.origin}/`).toString();
}
