export interface CoreHealth {
  status: "ok";
  service: "live-sticker-api" | "task-map-api";
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

const coreBaseUrl = (import.meta.env.VITE_CORE_API_BASE_URL ?? "/api").replace(/\/$/, "");

async function requestCore<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; payload: T }> {
  if (window.taskMapDesktop) {
    const result = await window.taskMapDesktop.requestCore({
      path,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    let payload: T;
    try {
      payload = JSON.parse(result.body) as T;
    } catch {
      payload = {} as T;
    }
    return { ok: result.status >= 200 && result.status < 300, status: result.status, payload };
  }
  const response = await fetch(`${coreBaseUrl}${path}`, init);
  const payload = await response.json().catch(() => ({})) as T;
  return { ok: response.ok, status: response.status, payload };
}

export function getCoreBaseUrl() {
  return coreBaseUrl;
}

export async function fetchCoreHealth(signal?: AbortSignal): Promise<CoreHealth> {
  if (!coreBaseUrl) {
    throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  }

  const response = await requestCore<CoreHealth>("/health", { signal });
  if (!response.ok) {
    throw new Error(`Core returned ${response.status}.`);
  }
  return response.payload;
}

export async function createTypographyJob(input: TypographyGenerationInput): Promise<TypographyGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<TypographyGenerationJob & { message?: string }>("/v1/live-sticker/typography/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}

export async function fetchTypographyJob(id: string): Promise<TypographyGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<TypographyGenerationJob & { message?: string }>(`/v1/live-sticker/typography/jobs/${id}`);
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}

export async function cutoutTypography(image: ImageReferenceInput): Promise<{ matte: "white" | "black"; result: NonNullable<TypographyGenerationJob["result"]> }> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<{ matte: "white" | "black"; result: NonNullable<TypographyGenerationJob["result"]>; message?: string }>("/v1/live-sticker/typography/cutout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.message || `Core returned ${response.status}.`);
  return payload;
}

export async function createBackgroundJob(input: { kind: BackgroundKind; prompt?: string; reference?: ImageReferenceInput }): Promise<BackgroundGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<BackgroundGenerationJob & { message?: string }>("/v1/live-sticker/background/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}

export async function fetchBackgroundJob(id: string): Promise<BackgroundGenerationJob> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<BackgroundGenerationJob & { message?: string }>(`/v1/live-sticker/background/jobs/${id}`);
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Core returned ${response.status}.`);
  return payload;
}

export interface TaskMapNodeInput {
  id: string;
  parentId?: string;
  title: string;
  note?: string;
}

export interface TaskMapBreakdownInput {
  task: TaskMapNodeInput;
  ancestors?: TaskMapNodeInput[];
  siblings?: TaskMapNodeInput[];
  locale?: "zh" | "en";
}

export interface TaskMapBreakdownItem {
  title: string;
  note?: string;
}

export interface TaskMapScheduleInput {
  parent: TaskMapNodeInput & { startDay: number; endDay: number };
  children: Array<TaskMapNodeInput & { startDay?: number; endDay?: number; lane?: number }>;
  locale?: "zh" | "en";
}

export interface TaskMapScheduleItem {
  id: string;
  startDay: number;
  endDay: number;
  lane: number;
  dependsOn?: string[];
  note?: string;
}

export async function createTaskBreakdown(input: TaskMapBreakdownInput): Promise<{ items: TaskMapBreakdownItem[]; provider: string }> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<{ items?: TaskMapBreakdownItem[]; provider?: string; message?: string }>("/v1/task-map/breakdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.message || `Core returned ${response.status}.`);
  return { items: payload.items ?? [], provider: payload.provider ?? "unknown" };
}

export async function createTaskSchedule(input: TaskMapScheduleInput): Promise<{ items: TaskMapScheduleItem[]; provider: string }> {
  if (!coreBaseUrl) throw new Error("VITE_CORE_API_BASE_URL is not configured.");
  const response = await requestCore<{ items?: TaskMapScheduleItem[]; provider?: string; message?: string }>("/v1/task-map/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = response.payload;
  if (!response.ok) throw new Error(payload.message || `Core returned ${response.status}.`);
  return { items: payload.items ?? [], provider: payload.provider ?? "unknown" };
}
