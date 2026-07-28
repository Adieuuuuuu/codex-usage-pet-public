import { resolve } from "node:path";

import {
  BrowserWindow,
  screen,
  type Point,
  type WebContents,
} from "electron";

import {
  CONTEXT_MENU_WINDOW_SIZE,
  positionContextMenu,
} from "../services/context-menu-position.ts";
import {
  IPC,
  type ContextMenuSnapshot,
} from "../shared/contracts.ts";

export interface ContextMenuControllerOptions {
  preloadPath: string;
  rendererPath: string;
  devTools: boolean;
}

export class ContextMenuController {
  readonly #options: ContextMenuControllerOptions;
  #window: BrowserWindow | null = null;

  constructor(options: ContextMenuControllerOptions) {
    this.#options = options;
  }

  show(anchor: Point): void {
    this.close();

    const display = screen.getDisplayNearestPoint(anchor);
    const position = positionContextMenu(anchor, display.workArea);
    let acceptsBlurClose = false;
    const menuWindow = new BrowserWindow({
      ...position,
      ...CONTEXT_MENU_WINDOW_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      roundedCorners: false,
      webPreferences: {
        preload: resolve(this.#options.preloadPath),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: this.#options.devTools,
      },
    });

    this.#window = menuWindow;
    menuWindow.setAlwaysOnTop(true, "floating");
    menuWindow.webContents.setWindowOpenHandler(() => ({
      action: "deny",
    }));
    menuWindow.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    menuWindow.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    menuWindow.on("blur", () => {
      if (!acceptsBlurClose) {
        return;
      }
      setImmediate(() => {
        if (
          this.#window === menuWindow &&
          !menuWindow.isDestroyed() &&
          !menuWindow.webContents.isDevToolsOpened()
        ) {
          this.close();
        }
      });
    });
    menuWindow.on("closed", () => {
      if (this.#window === menuWindow) {
        this.#window = null;
      }
    });
    menuWindow.once("ready-to-show", () => {
      if (!menuWindow.isDestroyed()) {
        menuWindow.show();
        menuWindow.focus();
        setTimeout(() => {
          acceptsBlurClose = true;
        }, 150);
      }
    });

    void menuWindow.loadFile(resolve(this.#options.rendererPath));
  }

  close(): void {
    const menuWindow = this.#window;
    this.#window = null;
    if (menuWindow !== null && !menuWindow.isDestroyed()) {
      menuWindow.destroy();
    }
  }

  isTrustedSender(sender: WebContents): boolean {
    return (
      this.#window !== null &&
      !this.#window.isDestroyed() &&
      !this.#window.webContents.isDestroyed() &&
      sender === this.#window.webContents
    );
  }

  sendSnapshot(snapshot: ContextMenuSnapshot): void {
    if (
      this.#window === null ||
      this.#window.isDestroyed() ||
      this.#window.webContents.isDestroyed()
    ) {
      return;
    }
    this.#window.webContents.send(
      IPC.contextMenuSnapshotChanged,
      snapshot,
    );
  }
}
