import { resolve } from "node:path";

import * as electron from "electron";
import type {
  BrowserWindow as ElectronBrowserWindow,
  Rectangle,
} from "electron";

import type {
  AppSnapshot,
  PointerDirection,
} from "../shared/contracts.ts";
import { IPC } from "../shared/contracts.ts";
import {
  MAX_SCALE,
  MIN_SCALE,
  type PreferencesStore,
  type WindowPosition,
} from "../services/preferences.ts";
import { directionIndexFromPoints } from "../services/pointer-direction.ts";

const { BrowserWindow, screen } = electron;

const BASE_WIDTH = 352;
const BASE_COLLAPSED_HEIGHT = 112;
const TASK_PANEL_FIXED_HEIGHT = 51;
const TASK_PANEL_ROW_STRIDE = 59;
const MAX_VISIBLE_TASK_ROWS = 10;
const SCALE_STEP = 0.1;
const EDGE_MARGIN = 18;
const POINTER_INTERVAL_MS = 80;
const TOPMOST_INTERVAL_MS = 5_000;

interface DragOrigin {
  cursor: Electron.Point;
  bounds: Rectangle;
}

export interface WindowControllerOptions {
  preloadPath: string;
  rendererPath: string;
  devTools: boolean;
  preferences: PreferencesStore;
  getSnapshot: () => AppSnapshot;
  onLayoutChanged: () => void;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const scaledSize = (
  scale: number,
  panelOpen: boolean,
  taskCount = 1,
): { width: number; height: number } => ({
  width: Math.round(BASE_WIDTH * scale),
  height: Math.round(
    (
      panelOpen
        ? BASE_COLLAPSED_HEIGHT +
          panelHeightForTaskCount(taskCount)
        : BASE_COLLAPSED_HEIGHT
    ) * scale,
  ),
});

export const panelHeightForTaskCount = (
  taskCount: number,
): number => {
  const visibleRows = clamp(
    Number.isFinite(taskCount) ? Math.floor(taskCount) : 0,
    1,
    MAX_VISIBLE_TASK_ROWS,
  );
  return (
    TASK_PANEL_FIXED_HEIGHT +
    TASK_PANEL_ROW_STRIDE * visibleRows
  );
};

const clampToWorkArea = (
  bounds: Rectangle,
  workArea: Rectangle,
): Rectangle => {
  const maximumX = Math.max(
    workArea.x,
    workArea.x + workArea.width - bounds.width,
  );
  const maximumY = Math.max(
    workArea.y,
    workArea.y + workArea.height - bounds.height,
  );
  return {
    ...bounds,
    x: clamp(bounds.x, workArea.x, maximumX),
    y: clamp(bounds.y, workArea.y, maximumY),
  };
};

export class WindowController {
  readonly #options: WindowControllerOptions;
  #window: ElectronBrowserWindow | null = null;
  #panelOpen = false;
  #panelAnchoredUp = false;
  #dragOrigin: DragOrigin | null = null;
  #pointerTimer: NodeJS.Timeout | null = null;
  #topmostTimer: NodeJS.Timeout | null = null;
  #lastPointerDirection: number | null | undefined;
  #quitting = false;

  constructor(options: WindowControllerOptions) {
    this.#options = options;
  }

  get window(): ElectronBrowserWindow | null {
    return this.#window;
  }

  get panelOpen(): boolean {
    return this.#panelOpen;
  }

  create(): ElectronBrowserWindow {
    const preferences = this.#options.preferences.value;
    const size = scaledSize(preferences.scale, false);
    const initialPosition =
      preferences.position ?? this.#defaultPosition(size.width, size.height);

    const window = new BrowserWindow({
      x: initialPosition.x,
      y: initialPosition.y,
      width: size.width,
      height: size.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
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
        backgroundThrottling: false,
        devTools: this.#options.devTools,
      },
    });

    this.#window = window;
    this.#setClampedBounds({
      ...window.getBounds(),
      ...size,
      ...initialPosition,
    });
    window.setAlwaysOnTop(true, "floating");

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    window.webContents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
    window.webContents.on("render-process-gone", () => {
      if (!this.#quitting && !window.isDestroyed()) {
        window.webContents.reload();
      }
    });
    window.on("close", (event) => {
      if (!this.#quitting) {
        event.preventDefault();
        window.hide();
      }
    });

    void window.loadFile(resolve(this.#options.rendererPath));
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) {
        window.showInactive();
      }
    });

    this.#startTimers();
    return window;
  }

  setQuitting(): void {
    this.#quitting = true;
  }

  destroy(): void {
    this.#stopTimers();
    if (this.#window !== null && !this.#window.isDestroyed()) {
      this.#window.destroy();
    }
    this.#window = null;
  }

  show(): void {
    if (this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    this.#window.showInactive();
    this.#window.setAlwaysOnTop(true, "floating");
  }

  hide(): void {
    this.#window?.hide();
  }

  toggleVisible(): void {
    if (this.#window?.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  sendSnapshot(snapshot: AppSnapshot): void {
    if (
      this.#window === null ||
      this.#window.isDestroyed() ||
      this.#window.webContents.isDestroyed()
    ) {
      return;
    }
    this.#syncPanelHeight(snapshot.tasks.length);
    this.#window.webContents.send(
      IPC.snapshotChanged,
      snapshot,
    );
  }

  setPanelOpen(open: boolean): void {
    if (
      this.#window === null ||
      this.#window.isDestroyed() ||
      this.#panelOpen === open
    ) {
      return;
    }

    const preferences = this.#options.preferences.value;
    const current = this.#window.getBounds();
    const nextSize = scaledSize(
      preferences.scale,
      open,
      this.#options.getSnapshot().tasks.length,
    );
    const display = screen.getDisplayMatching(current);
    const workAreaBottom = display.workArea.y + display.workArea.height;
    let nextY = current.y;

    if (open) {
      this.#panelAnchoredUp =
        current.y + nextSize.height > workAreaBottom;
      if (this.#panelAnchoredUp) {
        nextY = current.y + current.height - nextSize.height;
      }
    } else if (this.#panelAnchoredUp) {
      nextY = current.y + current.height - nextSize.height;
      this.#panelAnchoredUp = false;
    }

    this.#panelOpen = open;
    this.#setClampedBounds({
      x: current.x,
      y: nextY,
      ...nextSize,
    });
    this.#persistPosition();
    this.#options.onLayoutChanged();
  }

  setScale(scale: number): void {
    const nextScale =
      Math.round(clamp(scale, MIN_SCALE, MAX_SCALE) * 100) / 100;
    const previous = this.#options.preferences.value.scale;
    if (Math.abs(nextScale - previous) < 0.001) {
      return;
    }
    this.#options.preferences.update({ scale: nextScale });
    this.#applyCurrentSize();
    this.#options.onLayoutChanged();
  }

  adjustScale(delta: number): void {
    const current = this.#options.preferences.value.scale;
    const normalizedDelta =
      Math.abs(delta) < 0.001
        ? 0
        : Math.sign(delta) * SCALE_STEP;
    this.setScale(current + normalizedDelta);
  }

  prepareDrag(): void {
    if (this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    this.#dragOrigin = {
      cursor: screen.getCursorScreenPoint(),
      bounds: this.#window.getBounds(),
    };
  }

  moveDrag(): void {
    if (
      this.#window === null ||
      this.#window.isDestroyed() ||
      this.#dragOrigin === null
    ) {
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    this.#setClampedBounds({
      ...this.#dragOrigin.bounds,
      x:
        this.#dragOrigin.bounds.x +
        cursor.x -
        this.#dragOrigin.cursor.x,
      y:
        this.#dragOrigin.bounds.y +
        cursor.y -
        this.#dragOrigin.cursor.y,
    });
  }

  endDrag(): void {
    if (this.#dragOrigin === null) {
      return;
    }
    this.#dragOrigin = null;
    this.#persistPosition();
  }

  #applyCurrentSize(): void {
    if (this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    const current = this.#window.getBounds();
    const next = scaledSize(
      this.#options.preferences.value.scale,
      this.#panelOpen,
      this.#options.getSnapshot().tasks.length,
    );
    const centerX = current.x + current.width / 2;
    const centerY = current.y + current.height / 2;
    this.#setClampedBounds({
      x: Math.round(centerX - next.width / 2),
      y: Math.round(centerY - next.height / 2),
      ...next,
    });
    this.#persistPosition();
  }

  #syncPanelHeight(taskCount: number): void {
    if (
      !this.#panelOpen ||
      this.#window === null ||
      this.#window.isDestroyed()
    ) {
      return;
    }
    const current = this.#window.getBounds();
    const next = scaledSize(
      this.#options.preferences.value.scale,
      true,
      taskCount,
    );
    if (
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }

    const display = screen.getDisplayMatching(current);
    const workAreaBottom =
      display.workArea.y + display.workArea.height;
    if (
      !this.#panelAnchoredUp &&
      current.y + next.height > workAreaBottom
    ) {
      this.#panelAnchoredUp = true;
    }
    this.#setClampedBounds({
      x: current.x,
      y: this.#panelAnchoredUp
        ? current.y + current.height - next.height
        : current.y,
      ...next,
    });
    this.#persistPosition();
  }

  #defaultPosition(width: number, height: number): WindowPosition {
    const { workArea } = screen.getPrimaryDisplay();
    return {
      x: workArea.x + workArea.width - width - EDGE_MARGIN,
      y: workArea.y + workArea.height - height - EDGE_MARGIN,
    };
  }

  #setClampedBounds(bounds: Rectangle): void {
    if (this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    const display = screen.getDisplayMatching(bounds);
    this.#window.setBounds(
      clampToWorkArea(bounds, display.workArea),
      false,
    );
  }

  #persistPosition(): void {
    if (this.#window === null || this.#window.isDestroyed()) {
      return;
    }
    const { x, y } = this.#window.getBounds();
    this.#options.preferences.update({ position: { x, y } });
  }

  #startTimers(): void {
    this.#pointerTimer = setInterval(() => {
      this.#updatePointerDirection();
    }, POINTER_INTERVAL_MS);
    this.#pointerTimer.unref();

    this.#topmostTimer = setInterval(() => {
      if (
        this.#window !== null &&
        !this.#window.isDestroyed() &&
        this.#window.isVisible()
      ) {
        this.#window.setAlwaysOnTop(true, "floating");
        this.#window.setSkipTaskbar(true);
      }
    }, TOPMOST_INTERVAL_MS);
    this.#topmostTimer.unref();
  }

  #stopTimers(): void {
    if (this.#pointerTimer !== null) {
      clearInterval(this.#pointerTimer);
      this.#pointerTimer = null;
    }
    if (this.#topmostTimer !== null) {
      clearInterval(this.#topmostTimer);
      this.#topmostTimer = null;
    }
  }

  #updatePointerDirection(): void {
    const window = this.#window;
    const snapshot = this.#options.getSnapshot();
    let directionIndex: number | null = null;

    if (
      window !== null &&
      !window.isDestroyed() &&
      window.isVisible() &&
      snapshot.primaryState === "idle" &&
      snapshot.pet.spriteVersionNumber === 2
    ) {
      const bounds = window.getBounds();
      const scale = snapshot.scale;
      directionIndex = directionIndexFromPoints(
        screen.getCursorScreenPoint(),
        {
          x: bounds.x + Math.round(51 * scale),
          y: bounds.y + Math.round(56 * scale),
        },
        24 * scale,
      );
    }

    if (directionIndex === this.#lastPointerDirection) {
      return;
    }
    this.#lastPointerDirection = directionIndex;
    if (
      window !== null &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed()
    ) {
      const payload: PointerDirection = { directionIndex };
      window.webContents.send(
        IPC.pointerDirection,
        payload,
      );
    }
  }
}
