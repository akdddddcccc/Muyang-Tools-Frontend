export interface CoreHealth {
  status: "ok";
  service: "live-sticker-api";
  mode: "foundation";
  version: string;
  timestamp: string;
  providers: {
    imageGeneration: "not-configured" | "ready" | "unavailable";
    taskPlanning: "not-configured" | "ready" | "unavailable";
  };
}

const coreBaseUrl = (import.meta.env.VITE_CORE_API_BASE_URL ?? "").replace(/\/$/, "");

export function getCoreBaseUrl() {
  return coreBaseUrl;
}

export async function fetchCoreHealth(signal?: AbortSignal): Promise<CoreHealth> {
  if (!coreBaseUrl) {
    throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  }

  const response = await fetch(`${coreBaseUrl}/health`, { signal });
  if (!response.ok) {
    throw new Error(`Core returned ${response.status}.`);
  }

  return response.json() as Promise<CoreHealth>;
}
