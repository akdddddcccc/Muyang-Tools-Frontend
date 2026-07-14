interface TaskMapDesktopFileResult {
  canceled: boolean;
  path?: string;
  content?: string;
}

interface TaskMapDesktopCoreResult {
  status: number;
  body: string;
}

interface TaskMapDesktopBridge {
  isDesktop: true;
  getLaunchProject(): Promise<TaskMapDesktopFileResult>;
  openProject(): Promise<TaskMapDesktopFileResult>;
  saveProject(input: { path?: string; content: string; suggestedName?: string }): Promise<TaskMapDesktopFileResult>;
  setDirtyState(dirty: boolean): void;
  closeWindow(): Promise<boolean>;
  exportFile(input: { content: string; suggestedName: string; filters: Array<{ name: string; extensions: string[] }> }): Promise<TaskMapDesktopFileResult>;
  exportPdf(input: { html: string; suggestedName: string }): Promise<TaskMapDesktopFileResult>;
  requestCore(input: { path: string; method?: string; body?: string }): Promise<TaskMapDesktopCoreResult>;
  onProjectOpened(callback: (result: TaskMapDesktopFileResult) => void): () => void;
}

interface Window {
  taskMapDesktop?: TaskMapDesktopBridge;
}
