import { contextBridge, ipcRenderer } from "electron";

import type {
  AppSnapshot,
  PointerDirection,
  UsagePetApi,
} from "../shared/contracts.ts";
import { IPC } from "../shared/contracts.ts";

const subscribe = <T>(
  channel: string,
  callback: (payload: T) => void,
): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: UsagePetApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshotGet) as Promise<AppSnapshot>,
  onSnapshot: (callback) =>
    subscribe<AppSnapshot>(IPC.snapshotChanged, callback),
  onPointerDirection: (callback) =>
    subscribe<PointerDirection>(IPC.pointerDirection, callback),
  setPanelOpen: (open) => ipcRenderer.send(IPC.panelSetOpen, open),
  prepareDrag: () => ipcRenderer.send(IPC.dragPrepare),
  moveDrag: () => ipcRenderer.send(IPC.dragMove),
  endDrag: () => ipcRenderer.send(IPC.dragEnd),
  openThread: (threadId) =>
    ipcRenderer.invoke(IPC.threadOpen, threadId) as Promise<boolean>,
  adjustScale: (delta) => ipcRenderer.send(IPC.scaleAdjust, delta),
  showContextMenu: () => ipcRenderer.send(IPC.contextMenuShow),
  triggerPetReaction: (state) => ipcRenderer.send(IPC.petReaction, state),
};

contextBridge.exposeInMainWorld("usagePet", api);

declare global {
  interface Window {
    usagePet: UsagePetApi;
  }
}
