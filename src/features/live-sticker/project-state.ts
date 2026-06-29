import { useCallback, useEffect, useRef, useState } from "react";

const DATABASE_NAME = "muyang-live-sticker";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const CURRENT_PROJECT_KEY = "current";

export const COMPOSITION_OUTPUT = { width: 1080, height: 1920 } as const;

export type ProjectAssetKind =
  | "reference"
  | "color-reference"
  | "font-reference"
  | "layout-reference"
  | "top"
  | "bottom"
  | "side"
  | "typography"
  | "base-image";

export type CompositionLayerKind = Extract<ProjectAssetKind, "top" | "bottom" | "side" | "typography" | "base-image">;
export type TypographyPresetKey = "elegant-songti" | "expressive-calligraphy" | "rounded-cute" | "custom-reference";
export type TypographyMode = "create" | "refine";
export type TypographyMatte = "white" | "black";

export interface ProjectAsset {
  id: string;
  kind: ProjectAssetKind;
  source: "uploaded";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  trimmed: boolean;
  previewUrl: string;
  blob: Blob;
  createdAt: string;
}

export interface CompositionMask {
  mode: "default" | "manual";
  feather: number;
  fadePath: Array<{ x: number; y: number }>;
  edgeTexture: "none" | "flame" | "cloud";
}

export interface CompositionLayer {
  id: string;
  assetId: string;
  kind: CompositionLayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  mask: CompositionMask;
}

export interface CompositionDocument {
  aspectRatio: "9:16";
  selectedLayerId?: string;
  layers: CompositionLayer[];
  updatedAt: string;
}

export interface TypographySettings {
  fontPresetKey: TypographyPresetKey;
  text: string;
  instruction: string;
  mode: TypographyMode;
  matte: TypographyMatte;
}

export type PersistenceState = "loading" | "saving" | "saved" | "error";

interface PersistedProjectAsset extends Omit<ProjectAsset, "previewUrl"> {}

interface PersistedProject {
  schemaVersion: 1;
  id: typeof CURRENT_PROJECT_KEY;
  assets: PersistedProjectAsset[];
  composition: CompositionDocument;
  typography: TypographySettings;
  savedAt: string;
}

export const assetKindLabels: Record<ProjectAssetKind, string> = {
  reference: "色彩纹理参考",
  "color-reference": "文字颜色质感参考",
  "font-reference": "字体参考",
  "layout-reference": "布局文本参考",
  top: "上贴",
  bottom: "下贴",
  side: "侧贴",
  typography: "文字图层",
  "base-image": "直播间底图",
};

const composableKinds = new Set<CompositionLayerKind>(["base-image", "top", "bottom", "side", "typography"]);
const defaultLayerGeometry: Record<CompositionLayerKind, Omit<CompositionLayer, "id" | "assetId" | "kind" | "mask">> = {
  "base-image": { x: 0, y: 0, width: 100, height: 100, opacity: 100, visible: true, zIndex: 0 },
  top: { x: 0, y: 0, width: 100, height: 22, opacity: 100, visible: true, zIndex: 20 },
  bottom: { x: 0, y: 80, width: 100, height: 20, opacity: 100, visible: true, zIndex: 20 },
  side: { x: 84, y: 24, width: 16, height: 56, opacity: 100, visible: true, zIndex: 30 },
  typography: { x: 10, y: 40, width: 80, height: 14, opacity: 100, visible: true, zIndex: 40 },
};

function makeAssetId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyMask(): CompositionMask {
  return { mode: "default", feather: 24, fadePath: [], edgeTexture: "none" };
}

function createEmptyComposition(): CompositionDocument {
  return { aspectRatio: "9:16", layers: [], updatedAt: new Date().toISOString() };
}

function createDefaultTypography(): TypographySettings {
  return { fontPresetKey: "elegant-songti", text: "", instruction: "", mode: "create", matte: "white" };
}

function cloneComposition(composition: CompositionDocument): CompositionDocument {
  return JSON.parse(JSON.stringify(composition)) as CompositionDocument;
}

function normalizeComposition(composition: CompositionDocument): CompositionDocument {
  return {
    ...composition,
    layers: composition.layers.map((layer) => ({
      ...layer,
      mask: {
        ...emptyMask(),
        ...layer.mask,
        fadePath: layer.mask?.fadePath ?? [],
      },
    })),
  };
}

function isCompositionLayerKind(kind: ProjectAssetKind): kind is CompositionLayerKind {
  return composableKinds.has(kind as CompositionLayerKind);
}

function normalizeLayer(layer: CompositionLayer): CompositionLayer {
  const width = clamp(layer.width, 1, 100);
  const height = clamp(layer.height, 1, 100);
  return { ...layer, x: clamp(layer.x, 0, 100 - width), y: clamp(layer.y, 0, 100 - height), width, height, opacity: clamp(layer.opacity, 0, 100) };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function initialLayerGeometry(kind: CompositionLayerKind, imageAspect: number) {
  if (kind === "base-image") return defaultLayerGeometry[kind];
  const stageAspect = 9 / 16;
  const heightFor = (width: number, min: number, max: number) => clamp((width * stageAspect) / Math.max(imageAspect, 0.08), min, max);

  if (kind === "top") {
    const height = heightFor(100, 4, 100);
    return { ...defaultLayerGeometry.top, x: 0, y: 0, width: 100, height };
  }
  if (kind === "bottom") {
    const height = heightFor(100, 4, 100);
    return { ...defaultLayerGeometry.bottom, x: 0, y: 100 - height, width: 100, height };
  }
  if (kind === "side") {
    const width = 20;
    const height = heightFor(width, 10, 100);
    return { ...defaultLayerGeometry.side, x: 100 - width, y: (100 - height) / 2, width, height };
  }

  const width = 80;
  const height = heightFor(width, 8, 28);
  return { ...defaultLayerGeometry.typography, x: 10, y: (100 - height) / 2, width, height };
}

function addAssetToComposition(composition: CompositionDocument, asset: ProjectAsset, imageAspect: number): CompositionDocument {
  if (!isCompositionLayerKind(asset.kind)) return composition;
  const existing = composition.layers.find((layer) => layer.kind === asset.kind);
  const base = { ...initialLayerGeometry(asset.kind, imageAspect), mask: existing?.mask ?? emptyMask() };
  const nextLayer: CompositionLayer = { ...base, id: existing?.id ?? makeAssetId(), assetId: asset.id, kind: asset.kind };
  const layers = existing ? composition.layers.map((layer) => layer.id === existing.id ? nextLayer : layer) : [...composition.layers, nextLayer];
  return { ...composition, layers, selectedLayerId: nextLayer.id, updatedAt: new Date().toISOString() };
}

function removeAssetFromComposition(composition: CompositionDocument, assetId: string): CompositionDocument {
  const layers = composition.layers.filter((layer) => layer.assetId !== assetId);
  const selectedLayerId = composition.selectedLayerId && layers.some((layer) => layer.id === composition.selectedLayerId) ? composition.selectedLayerId : layers.at(-1)?.id;
  return { ...composition, layers, selectedLayerId, updatedAt: new Date().toISOString() };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_STORE)) request.result.createObjectStore(PROJECT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地项目数据库。"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地项目数据库操作失败。"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("本地项目数据库事务失败。"));
    transaction.onabort = () => reject(transaction.error ?? new Error("本地项目数据库事务已取消。"));
  });
}

async function loadPersistedProject(): Promise<PersistedProject | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const project = await requestResult(transaction.objectStore(PROJECT_STORE).get(CURRENT_PROJECT_KEY) as IDBRequest<PersistedProject | undefined>);
    await transactionDone(transaction);
    return project;
  } finally {
    database.close();
  }
}

async function savePersistedProject(project: PersistedProject): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(project, CURRENT_PROJECT_KEY);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function useProjectWorkspace() {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [composition, setComposition] = useState<CompositionDocument>(createEmptyComposition);
  const [typography, setTypography] = useState<TypographySettings>(createDefaultTypography);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>("loading");
  const [history, setHistory] = useState<{ past: CompositionDocument[]; future: CompositionDocument[] }>({ past: [], future: [] });
  const urls = useRef(new Set<string>());
  const ready = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const compositionRef = useRef(composition);
  const interactionStart = useRef<CompositionDocument | null>(null);

  useEffect(() => () => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => { compositionRef.current = composition; }, [composition]);

  useEffect(() => {
    let active = true;
    void loadPersistedProject().then(async (project) => {
      if (!active) return;
      if (project) {
        const restoredAssets = await Promise.all(project.assets.map(async (asset) => {
          const prepared = asset.kind === "typography" && !asset.trimmed
            ? await trimTransparentTypography(asset.blob)
            : { blob: asset.blob, trimmed: asset.trimmed ?? false };
          const previewUrl = URL.createObjectURL(prepared.blob);
          urls.current.add(previewUrl);
          return { ...asset, blob: prepared.blob, mimeType: prepared.blob.type || asset.mimeType, sizeBytes: prepared.blob.size, trimmed: prepared.trimmed, previewUrl };
        }));
        if (!active) {
          restoredAssets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
          return;
        }
        const restoredComposition = normalizeComposition(project.composition ?? createEmptyComposition());
        setAssets(restoredAssets);
        compositionRef.current = restoredComposition;
        setComposition(restoredComposition);
        setTypography({ ...createDefaultTypography(), ...project.typography });
      }
      ready.current = true;
      setPersistenceState("saved");
    }).catch(() => {
      if (!active) return;
      ready.current = true;
      setPersistenceState("error");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setPersistenceState("saving");
    saveTimer.current = window.setTimeout(() => {
      const persistedAssets: PersistedProjectAsset[] = assets.map(({ previewUrl: _previewUrl, ...asset }) => asset);
      void savePersistedProject({ schemaVersion: 1, id: CURRENT_PROJECT_KEY, assets: persistedAssets, composition, typography, savedAt: new Date().toISOString() })
        .then(() => setPersistenceState("saved"))
        .catch(() => setPersistenceState("error"));
    }, 220);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [assets, composition, typography]);

  const addAsset = useCallback(async (file: File, kind: ProjectAssetKind) => {
    if (!file.type.startsWith("image/")) throw new Error("请上传图片文件。");
    const prepared = kind === "typography" ? await trimTransparentTypography(file) : { blob: file, trimmed: false };
    const imageAspect = await getImageAspect(prepared.blob);
    const previewUrl = URL.createObjectURL(prepared.blob);
    urls.current.add(previewUrl);
    const asset: ProjectAsset = { id: makeAssetId(), kind, source: "uploaded", fileName: file.name, mimeType: prepared.blob.type || file.type, sizeBytes: prepared.blob.size, trimmed: prepared.trimmed, previewUrl, blob: prepared.blob, createdAt: new Date().toISOString() };
    setAssets((current) => [...current, asset]);
    setComposition((current) => {
      const next = addAssetToComposition(current, asset, imageAspect);
      compositionRef.current = next;
      return next;
    });
    return asset;
  }, []);

  const removeAsset = useCallback((assetId: string) => {
    setAssets((current) => {
      const asset = current.find((item) => item.id === assetId);
      if (asset) {
        URL.revokeObjectURL(asset.previewUrl);
        urls.current.delete(asset.previewUrl);
      }
      return current.filter((item) => item.id !== assetId);
    });
    setComposition((current) => {
      const next = removeAssetFromComposition(current, assetId);
      compositionRef.current = next;
      return next;
    });
  }, []);

  const selectLayer = useCallback((layerId: string) => {
    setComposition((current) => {
      const next = { ...current, selectedLayerId: layerId, updatedAt: new Date().toISOString() };
      compositionRef.current = next;
      return next;
    });
  }, []);

  const updateLayer = useCallback((layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => {
    setComposition((current) => {
      const next = { ...current, layers: current.layers.map((layer) => layer.id === layerId ? normalizeLayer({ ...layer, ...patch }) : layer), updatedAt: new Date().toISOString() };
      compositionRef.current = next;
      return next;
    });
  }, []);

  const updateLayerMask = useCallback((layerId: string, update: (mask: CompositionMask) => CompositionMask) => {
    setComposition((current) => {
      const next = { ...current, layers: current.layers.map((layer) => layer.id === layerId ? { ...layer, mask: update(layer.mask) } : layer), updatedAt: new Date().toISOString() };
      compositionRef.current = next;
      return next;
    });
  }, []);

  const beginCompositionInteraction = useCallback(() => { interactionStart.current = cloneComposition(compositionRef.current); }, []);
  const endCompositionInteraction = useCallback(() => {
    const before = interactionStart.current;
    interactionStart.current = null;
    if (!before || JSON.stringify(before) === JSON.stringify(compositionRef.current)) return;
    setHistory((current) => ({ past: [...current.past, before].slice(-50), future: [] }));
  }, []);

  const undoComposition = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      const restore = cloneComposition(previous);
      const present = cloneComposition(compositionRef.current);
      compositionRef.current = restore;
      setComposition(restore);
      return { past: current.past.slice(0, -1), future: [present, ...current.future].slice(0, 50) };
    });
  }, []);

  const redoComposition = useCallback(() => {
    setHistory((current) => {
      const next = current.future.at(0);
      if (!next) return current;
      const restore = cloneComposition(next);
      const present = cloneComposition(compositionRef.current);
      compositionRef.current = restore;
      setComposition(restore);
      return { past: [...current.past, present].slice(-50), future: current.future.slice(1) };
    });
  }, []);

  return {
    assets,
    composition,
    typography,
    persistenceState,
    projectReady: persistenceState !== "loading",
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    addAsset,
    removeAsset,
    selectLayer,
    updateLayer,
    updateLayerMask,
    beginCompositionInteraction,
    endCompositionInteraction,
    undoComposition,
    redoComposition,
    setTypography,
  };
}

async function trimTransparentTypography(file: Blob): Promise<{ blob: Blob; trimmed: boolean }> {
  if (file.type !== "image/png") return { blob: file, trimmed: false };
  const image = await loadLocalImage(file);
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context || !source.width || !source.height) return { blob: file, trimmed: false };
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[(y * source.width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return { blob: file, trimmed: false };
  const padding = Math.max(8, Math.round(Math.max(source.width, source.height) * 0.025));
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(source.width, maxX + padding + 1);
  const bottom = Math.min(source.height, maxY + padding + 1);
  if (left === 0 && top === 0 && right === source.width && bottom === source.height) return { blob: file, trimmed: false };

  const cropped = document.createElement("canvas");
  cropped.width = right - left;
  cropped.height = bottom - top;
  const cropContext = cropped.getContext("2d");
  if (!cropContext) return { blob: file, trimmed: false };
  cropContext.drawImage(source, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  const blob = await canvasToPng(cropped);
  return { blob, trimmed: true };
}

async function getImageAspect(file: Blob): Promise<number> {
  try {
    const image = await loadLocalImage(file);
    return image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  } catch {
    return 1;
  }
}

function loadLocalImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取文字图层图片。"));
    };
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("文字图层预剪裁失败。")), "image/png");
  });
}
