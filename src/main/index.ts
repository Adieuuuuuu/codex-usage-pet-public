import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";

import {
  IPC,
  type AppSnapshot,
  type ContextMenuAction,
  type ContextMenuSnapshot,
  type PetPackSnapshot,
} from "../shared/contracts.ts";
import { CodexMonitor } from "../services/codex-monitor.ts";
import { HookEventStore } from "../services/hook-event-store.ts";
import {
  PetPackRegistry,
  type ResolvedPetPack,
} from "../services/pet-registry.ts";
import {
  MAX_SCALE,
  MIN_SCALE,
  PreferencesStore,
} from "../services/preferences.ts";
import {
  normalizeRelayEndpoint,
} from "../services/phone-sync-protocol.ts";
import {
  PhoneSyncPublisher,
  type PhoneSyncStatus,
} from "../services/phone-sync-publisher.ts";
import {
  loadPhoneRelayConfig,
  PhoneSyncStore,
} from "../services/phone-sync-store.ts";
import { ThreadRepository } from "../services/thread-repository.ts";
import { resolveWindowsStartupExecutable } from "../services/windows-startup.ts";
import { ContextMenuController } from "./context-menu-controller.ts";
import { WindowController } from "./window-controller.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "usagepet",
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: false,
      supportFetchAPI: false,
      corsEnabled: false,
      stream: false,
    },
  },
]);

app.commandLine.appendSwitch(
  "autoplay-policy",
  "no-user-gesture-required",
);
app.setName("Usage Pet");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let controller: WindowController | null = null;
let contextMenuController: ContextMenuController | null = null;
let monitor: CodexMonitor | null = null;
let petRegistry: PetPackRegistry | null = null;
let preferences: PreferencesStore | null = null;
let phoneSyncStore: PhoneSyncStore | null = null;
let phoneSyncPublisher: PhoneSyncPublisher | null = null;
let phoneRelayEndpoint: string | null = null;
let pairingClipboardTimer: NodeJS.Timeout | null = null;
let copiedPairingCode: string | null = null;
let tray: Tray | null = null;
let quitting = false;

const projectRoot = resolve(__dirname, "..", "..");
const rendererPath = resolve(__dirname, "..", "renderer", "index.html");
const preloadPath = resolve(__dirname, "..", "preload", "index.cjs");
const contextMenuRendererPath = resolve(
  __dirname,
  "..",
  "renderer",
  "context-menu.html",
);
const contextMenuPreloadPath = resolve(
  __dirname,
  "..",
  "preload",
  "context-menu.cjs",
);

const getSelectedPack = (): ResolvedPetPack => {
  const selected = petRegistry?.getSelectedResolved() ?? null;
  if (selected === null) {
    throw new Error(
      "No valid Hatch Pet package is available. Install zhima-3 under ~/.codex/pets.",
    );
  }
  return selected;
};

const createSnapshot = (): AppSnapshot => {
  const selected = getSelectedPack().snapshot;
  const monitorSnapshot = monitor?.snapshot ?? {
    primaryState: "idle" as const,
    usage: {
      status: "unavailable" as const,
      weekly: null,
      reason: "Codex monitoring is starting.",
    },
    tasks: [],
    notificationTasks: [],
    codexRunning: false,
    hookMode: "fallback" as const,
  };

  return {
    pet: selected,
    primaryState: monitorSnapshot.primaryState,
    usage: monitorSnapshot.usage,
    tasks: monitorSnapshot.tasks,
    notificationTasks: monitorSnapshot.notificationTasks,
    scale: preferences?.value.scale ?? 1,
    panelOpen: controller?.panelOpen ?? false,
    codexRunning: monitorSnapshot.codexRunning,
    hookMode: monitorSnapshot.hookMode,
  };
};

const broadcastSnapshot = (): void => {
  try {
    controller?.sendSnapshot(createSnapshot());
  } catch {
    // A temporary missing pet is surfaced when the registry is rescanned.
  }
};

const trayImageForPack = (pack: ResolvedPetPack) => {
  const atlas = nativeImage.createFromPath(pack.spritesheetPath);
  if (atlas.isEmpty()) {
    return nativeImage.createFromPath(
      app.isPackaged
        ? join(process.resourcesPath, "icon.png")
        : join(projectRoot, "assets", "icon.png"),
    );
  }
  return atlas
    .crop({ x: 0, y: 0, width: 192, height: 208 })
    .resize({ width: 32, height: 32, quality: "best" });
};

const selectPet = (pet: PetPackSnapshot): void => {
  const selected = petRegistry?.select(pet.id);
  if (selected === null || selected === undefined) {
    return;
  }
  preferences?.update({ selectedPetId: selected.id });
  const resolved = petRegistry?.getSelectedResolved();
  if (tray !== null && resolved !== null && resolved !== undefined) {
    tray.setImage(trayImageForPack(resolved));
  }
  rebuildTrayMenu();
  broadcastSnapshot();
};

const refreshPets = async (): Promise<void> => {
  if (petRegistry === null) {
    return;
  }
  const refreshed = await petRegistry.refresh();
  if (refreshed.selected === null) {
    return;
  }
  preferences?.update({ selectedPetId: refreshed.selected.id });
  const resolved = petRegistry.getSelectedResolved();
  if (tray !== null && resolved !== null) {
    tray.setImage(trayImageForPack(resolved));
  }
  rebuildTrayMenu();
  broadcastSnapshot();
};

const setLoginStartup = (enabled: boolean): void => {
  const startupPath = resolveWindowsStartupExecutable(
    process.execPath,
    process.env.PORTABLE_EXECUTABLE_FILE,
  );
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: startupPath,
    args: ["--background"],
  });
};

const isLoginStartupEnabled = (): boolean => {
  const startupPath = resolveWindowsStartupExecutable(
    process.execPath,
    process.env.PORTABLE_EXECUTABLE_FILE,
  );
  return app.getLoginItemSettings({
    path: startupPath,
    args: ["--background"],
  }).openAtLogin;
};

const createContextMenuSnapshot = (): ContextMenuSnapshot => {
  const petSnapshot = petRegistry?.getSnapshot();
  const selectedId =
    petRegistry?.getSelectedResolved()?.snapshot.id ?? null;
  return {
    petVisible: controller?.window?.isVisible() ?? false,
    scale: preferences?.value.scale ?? 1,
    minimumScale: MIN_SCALE,
    maximumScale: MAX_SCALE,
    selectedPetId: selectedId,
    pets:
      petSnapshot?.pets.map(({ id, displayName }) => ({
        id,
        displayName,
      })) ?? [],
    startupEnabled: isLoginStartupEnabled(),
    phoneSyncStatus:
      phoneRelayEndpoint === null &&
      phoneSyncStore?.pairing === null
        ? "unavailable"
        : (phoneSyncPublisher?.status ?? "unpaired"),
  };
};

const phoneSyncMenuLabel = (): string => {
  const status = createContextMenuSnapshot().phoneSyncStatus;
  switch (status) {
    case "active":
      return "手机同步已开启";
    case "publishing":
    case "offline":
      return "手机同步连接中";
    case "auth-failed":
      return "手机同步需重新配对";
    case "unavailable":
      return "连接手机（待部署）";
    case "unpaired":
    default:
      return "连接手机";
  }
};

const refreshPhoneSyncMenus = (): void => {
  rebuildTrayMenu();
  contextMenuController?.sendSnapshot(createContextMenuSnapshot());
};

const clearPairingClipboard = (): void => {
  if (pairingClipboardTimer !== null) {
    clearTimeout(pairingClipboardTimer);
    pairingClipboardTimer = null;
  }
  if (
    copiedPairingCode !== null &&
    clipboard.readText() === copiedPairingCode
  ) {
    clipboard.clear();
  }
  copiedPairingCode = null;
};

const copyPhonePairingCode = (): boolean => {
  const pairingUri = phoneSyncStore?.pairingUri() ?? null;
  if (pairingUri === null) {
    return false;
  }
  clearPairingClipboard();
  clipboard.writeText(pairingUri);
  copiedPairingCode = pairingUri;
  pairingClipboardTimer = setTimeout(
    clearPairingClipboard,
    5 * 60_000,
  );
  pairingClipboardTimer.unref();
  return true;
};

const showPairingCopied = async (): Promise<void> => {
  await dialog.showMessageBox({
    type: "info",
    title: "连接手机",
    message: "配对代码已复制",
    detail:
      "请在 Codex Usage Pet on Phone 中粘贴并连接。"
      + "为安全起见，电脑剪贴板中的代码会在 5 分钟后清除。",
    buttons: ["知道了"],
    defaultId: 0,
    noLink: true,
  });
};

const confirmPhoneSyncReset = async (
  message: string,
  detail: string,
  confirmLabel: string,
): Promise<boolean> => {
  const result = await dialog.showMessageBox({
    type: "warning",
    title: "手机同步",
    message,
    detail,
    buttons: [confirmLabel, "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
};

const showPhoneSyncDialog = async (): Promise<void> => {
  if (phoneSyncStore === null || phoneSyncPublisher === null) {
    return;
  }
  const existing = phoneSyncStore.pairing;
  if (existing === null) {
    if (phoneRelayEndpoint === null) {
      await dialog.showMessageBox({
        type: "info",
        title: "连接手机",
        message: "Cloudflare 中转尚未部署",
        detail: "完成首次部署后，这里会直接生成配对代码。",
        buttons: ["知道了"],
        defaultId: 0,
        noLink: true,
      });
      return;
    }
    try {
      phoneSyncStore.createPairing(phoneRelayEndpoint);
      if (monitor !== null) {
        phoneSyncPublisher.pairingChanged(monitor.snapshot);
      }
      copyPhonePairingCode();
      refreshPhoneSyncMenus();
      await showPairingCopied();
    } catch {
      await dialog.showMessageBox({
        type: "error",
        title: "连接手机",
        message: "无法保护配对代码",
        detail: "手机同步保持关闭，Codex 数据没有被发送。",
        buttons: ["知道了"],
        defaultId: 0,
        noLink: true,
      });
    }
    return;
  }

  const result = await dialog.showMessageBox({
    type: "info",
    title: "手机同步",
    message: phoneSyncMenuLabel(),
    buttons: ["复制配对代码", "重新配对", "停止同步", "取消"],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  });

  if (result.response === 0) {
    if (copyPhonePairingCode()) {
      await showPairingCopied();
    }
    return;
  }

  if (result.response === 1) {
    const confirmed = await confirmPhoneSyncReset(
      "重新配对？",
      "当前手机会停止接收，必须使用新配对代码重新连接。",
      "重新配对",
    );
    if (!confirmed) {
      return;
    }
    phoneSyncStore.rotatePairing(existing.endpoint);
    if (monitor !== null) {
      phoneSyncPublisher.pairingChanged(monitor.snapshot);
    }
    copyPhonePairingCode();
    refreshPhoneSyncMenus();
    await showPairingCopied();
    return;
  }

  if (result.response === 2) {
    const confirmed = await confirmPhoneSyncReset(
      "停止手机同步？",
      "本机配对会被清除，手机将保留最后一次状态。",
      "停止同步",
    );
    if (!confirmed) {
      return;
    }
    try {
      phoneSyncStore.clear();
    } catch {
      await dialog.showMessageBox({
        type: "error",
        title: "手机同步",
        message: "无法清除本机配对",
        detail: "同步仍保持原状态，请稍后重试。",
        buttons: ["知道了"],
        defaultId: 0,
        noLink: true,
      });
      return;
    }
    if (monitor !== null) {
      phoneSyncPublisher.pairingChanged(monitor.snapshot);
    }
    refreshPhoneSyncMenus();
  }
};

const buildContextMenu = (): Menu => {
  const selectedId = petRegistry?.getSelectedResolved()?.snapshot.id;
  const petItems: MenuItemConstructorOptions[] =
    petRegistry?.getSnapshot().pets.map((pet) => ({
      label: pet.displayName,
      type: "radio",
      checked: pet.id === selectedId,
      click: () => selectPet(pet),
    })) ?? [];
  const startupEnabled = isLoginStartupEnabled();

  return Menu.buildFromTemplate([
    {
      label: controller?.window?.isVisible() ? "隐藏桌宠" : "显示桌宠",
      click: () => controller?.toggleVisible(),
    },
    { type: "separator" },
    {
      label: "缩小",
      accelerator: "Ctrl+-",
      click: () => controller?.adjustScale(-0.1),
    },
    {
      label: "放大",
      accelerator: "Ctrl+=",
      click: () => controller?.adjustScale(0.1),
    },
    {
      label: "恢复默认大小",
      click: () => controller?.setScale(1),
    },
    { type: "separator" },
    {
      label: "宠物",
      submenu:
        petItems.length > 0
          ? petItems
          : [{ label: "未发现有效宠物包", enabled: false }],
    },
    {
      label: "重新扫描宠物",
      click: () => {
        void refreshPets();
      },
    },
    { type: "separator" },
    {
      label: "随 Windows 登录启动",
      type: "checkbox",
      checked: startupEnabled,
      click: (item) => {
        setLoginStartup(item.checked);
        rebuildTrayMenu();
      },
    },
    {
      label: "打开 Codex",
      click: () => {
        void shell.openExternal("codex://");
      },
    },
    {
      label: phoneSyncMenuLabel(),
      click: () => {
        void showPhoneSyncDialog();
      },
    },
    { type: "separator" },
    {
      label: "退出 Usage Pet",
      click: () => {
        quitting = true;
        controller?.setQuitting();
        app.quit();
      },
    },
  ]);
};

function rebuildTrayMenu(): void {
  tray?.setContextMenu(buildContextMenu());
}

const isTrustedSender = (
  event: IpcMainEvent | IpcMainInvokeEvent,
): boolean =>
  controller?.window !== null &&
  controller?.window !== undefined &&
  !controller.window.isDestroyed() &&
  event.sender === controller.window.webContents;

const isTrustedContextMenuSender = (
  event: IpcMainEvent | IpcMainInvokeEvent,
): boolean =>
  contextMenuController?.isTrustedSender(event.sender) ?? false;

const isContextMenuAction = (
  value: unknown,
): value is ContextMenuAction => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case "adjust-scale":
      return action.delta === -0.1 || action.delta === 0.1;
    case "select-pet":
      return typeof action.petId === "string";
    case "hide-pet":
    case "reset-scale":
    case "refresh-pets":
    case "toggle-startup":
    case "phone-sync":
    case "open-codex":
    case "quit":
    case "dismiss":
      return true;
    default:
      return false;
  }
};

const handleContextMenuAction = (
  action: ContextMenuAction,
): void => {
  const keepOpen =
    action.type === "adjust-scale" || action.type === "reset-scale";
  if (!keepOpen) {
    contextMenuController?.close();
  }

  switch (action.type) {
    case "hide-pet":
      controller?.toggleVisible();
      break;
    case "adjust-scale":
      controller?.adjustScale(action.delta);
      break;
    case "reset-scale":
      controller?.setScale(1);
      break;
    case "select-pet": {
      const pet = petRegistry
        ?.getSnapshot()
        .pets.find(({ id }) => id === action.petId);
      if (pet !== undefined) {
        selectPet(pet);
      }
      break;
    }
    case "refresh-pets":
      void refreshPets();
      break;
    case "toggle-startup":
      setLoginStartup(!isLoginStartupEnabled());
      rebuildTrayMenu();
      break;
    case "phone-sync":
      void showPhoneSyncDialog();
      break;
    case "open-codex":
      void shell.openExternal("codex://");
      break;
    case "quit":
      quitting = true;
      controller?.setQuitting();
      app.quit();
      break;
    case "dismiss":
      break;
  }

  if (keepOpen) {
    contextMenuController?.sendSnapshot(
      createContextMenuSnapshot(),
    );
  }
};

const installIpcHandlers = (): void => {
  ipcMain.handle(IPC.snapshotGet, (event) => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC sender");
    }
    return createSnapshot();
  });

  ipcMain.on(IPC.panelSetOpen, (event, open: unknown) => {
    if (isTrustedSender(event) && typeof open === "boolean") {
      controller?.setPanelOpen(open);
    }
  });
  ipcMain.on(IPC.dragPrepare, (event) => {
    if (isTrustedSender(event)) {
      controller?.prepareDrag();
    }
  });
  ipcMain.on(IPC.dragMove, (event) => {
    if (isTrustedSender(event)) {
      controller?.moveDrag();
    }
  });
  ipcMain.on(IPC.dragEnd, (event) => {
    if (isTrustedSender(event)) {
      controller?.endDrag();
    }
  });
  ipcMain.on(IPC.scaleAdjust, (event, delta: unknown) => {
    if (
      isTrustedSender(event) &&
      typeof delta === "number" &&
      Number.isFinite(delta) &&
      Math.abs(delta) <= 0.25
    ) {
      controller?.adjustScale(delta);
    }
  });
  ipcMain.on(IPC.contextMenuShow, (event) => {
    if (isTrustedSender(event)) {
      contextMenuController?.show(screen.getCursorScreenPoint());
    }
  });
  ipcMain.handle(IPC.contextMenuSnapshotGet, (event) => {
    if (!isTrustedContextMenuSender(event)) {
      throw new Error("Untrusted context menu IPC sender");
    }
    return createContextMenuSnapshot();
  });
  ipcMain.on(IPC.contextMenuAction, (event, action: unknown) => {
    if (
      isTrustedContextMenuSender(event) &&
      isContextMenuAction(action)
    ) {
      handleContextMenuAction(action);
    }
  });
  ipcMain.on(IPC.petReaction, (event, reaction: unknown) => {
    if (
      !isTrustedSender(event) ||
      (reaction !== "jumping" && reaction !== "waving")
    ) {
      return;
    }
    // The renderer owns this short visual override. Main validates the
    // message so the channel cannot be repurposed into a system action.
  });

  ipcMain.handle(
    IPC.threadOpen,
    async (event, threadId: unknown): Promise<boolean> => {
      if (
        !isTrustedSender(event) ||
        typeof threadId !== "string" ||
        !UUID_PATTERN.test(threadId)
      ) {
        return false;
      }
      const known = monitor?.snapshot.tasks.some(
        (task) => task.id === threadId,
      );
      if (!known) {
        return false;
      }
      try {
        await shell.openExternal(`codex://threads/${threadId}`);
        return true;
      } catch {
        try {
          await shell.openExternal("codex://");
        } catch {
          return false;
        }
        return false;
      }
    },
  );
};

const registerPetProtocol = (): void => {
  protocol.handle("usagepet", async (request) => {
    try {
      const url = new URL(request.url);
      const pieces = url.pathname
        .split("/")
        .filter(Boolean)
        .map((piece) => decodeURIComponent(piece));
      if (
        url.hostname !== "pet" ||
        pieces.length !== 2 ||
        pieces[1] !== "spritesheet"
      ) {
        return new Response("Not found", { status: 404 });
      }
      const pack = petRegistry?.getResolvedPack(pieces[0] ?? "");
      if (pack === null || pack === undefined) {
        return new Response("Not found", { status: 404 });
      }
      const contents = await readFile(pack.spritesheetPath);
      return new Response(new Uint8Array(contents), {
        status: 200,
        headers: {
          "content-type": pack.mediaType,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
};

const bootstrap = async (): Promise<void> => {
  app.setAppUserModelId("com.adie.usagepet");

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  const codexHome =
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const userData = app.getPath("userData");
  const packagedPetRoot = app.isPackaged
    ? join(process.resourcesPath, "pets")
    : join(projectRoot, "assets", "pets");

  preferences = new PreferencesStore(
    join(userData, "preferences.json"),
  );
  petRegistry = new PetPackRegistry({
    roots: [join(codexHome, "pets"), packagedPetRoot],
    selectedId: preferences.value.selectedPetId,
  });
  const pets = await petRegistry.refresh();
  if (pets.selected === null) {
    throw new Error(
      "Usage Pet could not find a valid Hatch Pet package.",
    );
  }
  preferences.update({ selectedPetId: pets.selected.id });

  registerPetProtocol();

  const repository = new ThreadRepository(
    join(codexHome, "state_5.sqlite"),
    [
      join(codexHome, "sessions"),
      join(codexHome, "archived_sessions"),
    ],
  );
  monitor = new CodexMonitor(
    repository,
    new HookEventStore(join(userData, "hook-events.jsonl")),
  );
  try {
    const environmentEndpoint =
      process.env.USAGE_PET_PHONE_RELAY_URL?.trim();
    const relayConfig = loadPhoneRelayConfig(
      join(userData, "phone-relay.json"),
    );
    phoneRelayEndpoint =
      environmentEndpoint !== undefined && environmentEndpoint !== ""
        ? normalizeRelayEndpoint(environmentEndpoint)
        : (relayConfig?.endpoint ?? null);
    if (relayConfig?.proxy !== null && relayConfig?.proxy !== undefined) {
      await session.defaultSession.setProxy({
        proxyRules: relayConfig.proxy,
      });
    }
  } catch {
    phoneRelayEndpoint = null;
  }
  phoneSyncStore = new PhoneSyncStore(
    join(userData, "phone-sync.json"),
    {
      isEncryptionAvailable: () =>
        safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  );
  phoneSyncPublisher = new PhoneSyncPublisher({
    store: phoneSyncStore,
    fetch: (input, init) =>
      net.fetch(input instanceof URL ? input.toString() : input, init),
    onStatus: (_status: PhoneSyncStatus) => {
      refreshPhoneSyncMenus();
    },
  });

  controller = new WindowController({
    preloadPath,
    rendererPath,
    devTools: !app.isPackaged,
    preferences,
    getSnapshot: createSnapshot,
    onLayoutChanged: broadcastSnapshot,
  });
  controller.create();
  contextMenuController = new ContextMenuController({
    preloadPath: contextMenuPreloadPath,
    rendererPath: contextMenuRendererPath,
    devTools: !app.isPackaged,
  });

  installIpcHandlers();

  const selectedPack = getSelectedPack();
  tray = new Tray(trayImageForPack(selectedPack));
  tray.setToolTip("Usage Pet · Codex 桌宠");
  tray.on("click", () => controller?.toggleVisible());
  rebuildTrayMenu();

  monitor.subscribe((snapshot) => {
    broadcastSnapshot();
    phoneSyncPublisher?.update(snapshot);
  });
  monitor.start();

  if (!app.isPackaged && process.argv.includes("--capture-smoke")) {
    setTimeout(() => {
      void (async () => {
        const window = controller?.window;
        if (window === null || window === undefined || window.isDestroyed()) {
          return;
        }
        const captureDirectory = join(projectRoot, "output", "electron");
        await mkdir(captureDirectory, { recursive: true });
        const image = await window.webContents.capturePage();
        await writeFile(
          join(captureDirectory, "runtime.png"),
          image.toPNG(),
        );
        quitting = true;
        controller?.setQuitting();
        app.quit();
      })();
    }, 3_500);
  }
};

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    controller?.show();
  });
  app.on("activate", () => {
    controller?.show();
  });
  app.on("window-all-closed", () => {
    // Tray ownership keeps the desktop companion alive.
  });
  app.on("before-quit", () => {
    quitting = true;
    controller?.setQuitting();
    monitor?.stop();
    phoneSyncPublisher?.stop();
    phoneSyncPublisher = null;
    phoneSyncStore = null;
    clearPairingClipboard();
    contextMenuController?.close();
    contextMenuController = null;
    controller?.destroy();
    tray?.destroy();
    tray = null;
  });

  void app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unknown startup error";
      if (app.isPackaged) {
        dialog.showErrorBox(
          "Usage Pet 启动失败",
          `${message}\n\nCodex 数据没有被修改。`,
        );
      } else {
        console.error("Usage Pet startup failed:", message);
      }
      quitting = true;
      app.quit();
    });
}
