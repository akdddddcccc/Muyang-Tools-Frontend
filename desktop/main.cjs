const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectExtension = ".my";
const coreBaseUrl = (process.env.TASK_MAP_CORE_API_BASE_URL || "https://www.cmuyang23333.top/api").replace(/\/$/, "");
let mainWindow;
let launchProjectPath;
let projectDirty = false;
let closeDialogOpen = false;
let allowWindowClose = false;

function projectPathFromArgs(argv) {
  return argv.find((value) => typeof value === "string" && value.toLowerCase().endsWith(projectExtension));
}

async function readProject(filePath) {
  if (!filePath) return { canceled: true };
  try {
    return { canceled: false, path: filePath, content: await fs.readFile(filePath, "utf8") };
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "无法打开项目",
      message: "这个 .my 文件无法读取。",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { canceled: true };
  }
}

async function writeFileSafely(filePath, content) {
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, content, "utf8");
  try {
    await fs.rename(temporaryPath, filePath);
  } catch {
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }
}

async function chooseProjectFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开 Task Map 项目",
    properties: ["openFile"],
    filters: [{ name: "MUYANG Task Map 项目", extensions: ["my"] }],
  });
  return result.canceled ? { canceled: true } : readProject(result.filePaths[0]);
}

async function saveProject(input) {
  let filePath = input.path;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存 Task Map 项目",
      defaultPath: input.suggestedName || "未命名计划.my",
      filters: [{ name: "MUYANG Task Map 项目", extensions: ["my"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = result.filePath.toLowerCase().endsWith(projectExtension) ? result.filePath : `${result.filePath}${projectExtension}`;
  }
  await writeFileSafely(filePath, input.content);
  return { canceled: false, path: filePath };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#0b1015",
    title: "MUYANG Task Map",
    icon: path.join(__dirname, "..", "build", "task-map-icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      defaultFontFamily: {
        standard: "Microsoft YaHei UI",
        sansSerif: "Microsoft YaHei",
        serif: "Microsoft YaHei",
        monospace: "Consolas",
      },
    },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (allowWindowClose || !projectDirty) return;
    event.preventDefault();
    if (closeDialogOpen) return;
    closeDialogOpen = true;
    void dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "项目尚未保存",
      message: "当前工程还有未保存的修改。",
      detail: "选择“不保存退出”会丢失这些修改；也可以继续编辑并先保存工程。",
      buttons: ["继续编辑", "不保存退出"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      closeDialogOpen = false;
      if (response !== 1) return;
      allowWindowClose = true;
      mainWindow?.close();
    });
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "allow" }));
  void mainWindow.loadFile(path.join(__dirname, "..", "dist-desktop", "index.html"));
}

ipcMain.handle("task-map:get-launch-project", async () => {
  const filePath = launchProjectPath;
  launchProjectPath = undefined;
  return readProject(filePath);
});
ipcMain.handle("task-map:open-project", chooseProjectFile);
ipcMain.handle("task-map:save-project", (_event, input) => saveProject(input));
ipcMain.on("task-map:set-dirty-state", (event, dirty) => {
  if (mainWindow && event.sender === mainWindow.webContents) projectDirty = dirty === true;
});
ipcMain.handle("task-map:close-window", () => {
  mainWindow?.close();
  return true;
});
ipcMain.handle("task-map:export-file", async (_event, input) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出文件",
    defaultPath: input.suggestedName,
    filters: input.filters,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFileSafely(result.filePath, input.content);
  return { canceled: false, path: result.filePath };
});
ipcMain.handle("task-map:export-pdf", async (_event, input) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 PDF",
    defaultPath: input.suggestedName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`);
    const pdf = await printWindow.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fs.writeFile(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  } finally {
    printWindow.destroy();
  }
});
ipcMain.handle("task-map:core-request", async (_event, input) => {
  const requestPath = typeof input.path === "string" ? input.path : "";
  if (requestPath !== "/health" && !requestPath.startsWith("/v1/task-map/")) {
    return { status: 403, body: JSON.stringify({ message: "Desktop API path is not allowed." }) };
  }
  const response = await fetch(`${coreBaseUrl}${requestPath}`, {
    method: input.method || "GET",
    headers: input.body ? { "Content-Type": "application/json" } : undefined,
    body: input.body,
  });
  return { status: response.status, body: await response.text() };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  launchProjectPath = projectPathFromArgs(process.argv.slice(1));
  app.on("second-instance", (_event, argv) => {
    const filePath = projectPathFromArgs(argv);
    if (filePath && mainWindow) void readProject(filePath).then((result) => mainWindow.webContents.send("task-map:project-opened", result));
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
