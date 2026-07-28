import { contextBridge, ipcRenderer } from "electron";

import type {
  ContextMenuAction,
  ContextMenuSnapshot,
  UsagePetContextMenuApi,
} from "../shared/contracts.ts";
import { IPC } from "../shared/contracts.ts";

const api: UsagePetContextMenuApi = {
  getSnapshot: () =>
    ipcRenderer.invoke(
      IPC.contextMenuSnapshotGet,
    ) as Promise<ContextMenuSnapshot>,
  onSnapshot: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: ContextMenuSnapshot,
    ): void => {
      callback(snapshot);
    };
    ipcRenderer.on(IPC.contextMenuSnapshotChanged, listener);
    return () =>
      ipcRenderer.removeListener(
        IPC.contextMenuSnapshotChanged,
        listener,
      );
  },
  performAction: (action: ContextMenuAction) =>
    ipcRenderer.send(IPC.contextMenuAction, action),
};

contextBridge.exposeInMainWorld("usagePetContextMenu", api);

declare global {
  interface Window {
    usagePetContextMenu: UsagePetContextMenuApi;
  }
}
