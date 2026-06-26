export interface ServerConfig {
  port: number;
  host: string;
  jwtSecret: string;
  storage: "azure" | "filesystem";
  dataDir: string;
  azureConnectionString: string | undefined;
  azureContainer: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const storage = env.STORAGE === "azure" ? "azure" : "filesystem";
  const jwtSecret = env.JWT_SECRET ?? "dev-insecure-secret-change-me";
  if (env.NODE_ENV === "production" && jwtSecret === "dev-insecure-secret-change-me") {
    throw new Error("JWT_SECRET must be set in production");
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    jwtSecret,
    storage,
    dataDir: env.DATA_DIR ?? "./.ifc-vcs-data",
    azureConnectionString: env.AZURE_STORAGE_CONNECTION_STRING,
    azureContainer: env.AZURE_STORAGE_CONTAINER ?? "ifc-versions",
  };
}
