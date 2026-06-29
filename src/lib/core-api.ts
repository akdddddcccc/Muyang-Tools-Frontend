export interface CoreHealth {
  status: "ok";
  service: "live-sticker-api";
  mode: "foundation" | "staging" | "production";
  version: string;
  timestamp: string;
  providers: {
    imageGeneration: "not-configured" | "ready" | "unavailable";
    taskPlanning: "not-configured" | "ready" | "unavailable";
    typographyGeneration?: "not-configured" | "ready" | "unavailable";
    typographyProvider?: "ofox";
    typographyMode?: "built-in" | "external-adapter" | "not-configured";
  };
}

export interface ImageReferenceInput {
  assetId?: string;
  mimeType?: string;
  dataUrl?: string;
}

export interface TypographyGenerationInput {
  text: string;
  fontPresetKey: string;
  mode: "create" | "refine";
  matte: "white" | "black";
  instruction?: string;
  references?: {
    color?: ImageReferenceInput;
    font?: ImageReferenceInput;
    layout?: ImageReferenceInput;
    typography?: ImageReferenceInput;
  };
}

export interface TypographyGenerationJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: {
    fileName: string;
    mimeType: string;
    url: string;
  };
  error?: { code: string; message: string };
}

export type BackgroundKind = "top" | "bottom" | "side";

export interface BackgroundGenerationJob extends TypographyGenerationJob {
  result?: TypographyGenerationJob["result"] & { kind?: BackgroundKind };
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

export async function createTypographyJob(input: TypographyGenerationInput): Promise<TypographyGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await fetch(`${coreBaseUrl}/v1/live-sticker/typography/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as TypographyGenerationJob & { message?: string };
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}

export async function createBackgroundJob(input: { kind: BackgroundKind; prompt?: string; reference?: ImageReferenceInput }): Promise<BackgroundGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await fetch(`${coreBaseUrl}/v1/live-sticker/background/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as BackgroundGenerationJob & { message?: string };
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}
