export type PetAnimationState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type TaskStatus = "running" | "waiting" | "review" | "failed";

export interface UsageWindowSnapshot {
  remainingPercent: number;
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
  capturedAt: string;
  source: "rollout";
}

export interface UsageSnapshot {
  status: "available" | "unavailable" | "stale";
  weekly: UsageWindowSnapshot | null;
  reason?: string;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  workspaceName: string | null;
  status: TaskStatus;
  updatedAt: number;
  canOpen: boolean;
}

export type TaskNotificationSnapshot = Pick<
  TaskSnapshot,
  "id" | "status"
>;

export interface PetPackSnapshot {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 1 | 2;
  atlasWidth: 1536;
  atlasHeight: 1872 | 2288;
  frameWidth: 192;
  frameHeight: 208;
  assetUrl: string;
}

export interface AppSnapshot {
  pet: PetPackSnapshot;
  primaryState: Exclude<PetAnimationState, "running-left" | "running-right">;
  usage: UsageSnapshot;
  tasks: TaskSnapshot[];
  notificationTasks: TaskNotificationSnapshot[];
  scale: number;
  panelOpen: boolean;
  codexRunning: boolean;
  hookMode: "connected" | "fallback";
}

export interface PointerDirection {
  directionIndex: number | null;
}

export interface UsagePetApi {
  getSnapshot(): Promise<AppSnapshot>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onPointerDirection(callback: (pointer: PointerDirection) => void): () => void;
  setPanelOpen(open: boolean): void;
  prepareDrag(): void;
  moveDrag(): void;
  endDrag(): void;
  openThread(threadId: string): Promise<boolean>;
  adjustScale(delta: number): void;
  showContextMenu(): void;
  triggerPetReaction(state: "jumping" | "waving"): void;
}

export interface ContextMenuSnapshot {
  petVisible: boolean;
  scale: number;
  minimumScale: number;
  maximumScale: number;
  selectedPetId: string | null;
  pets: Array<Pick<PetPackSnapshot, "id" | "displayName">>;
  startupEnabled: boolean;
  phoneSyncStatus:
    | "unavailable"
    | "unpaired"
    | "publishing"
    | "active"
    | "offline"
    | "auth-failed";
}

export type ContextMenuAction =
  | { type: "hide-pet" }
  | { type: "adjust-scale"; delta: -0.1 | 0.1 }
  | { type: "reset-scale" }
  | { type: "select-pet"; petId: string }
  | { type: "refresh-pets" }
  | { type: "toggle-startup" }
  | { type: "phone-sync" }
  | { type: "open-codex" }
  | { type: "quit" }
  | { type: "dismiss" };

export interface UsagePetContextMenuApi {
  getSnapshot(): Promise<ContextMenuSnapshot>;
  onSnapshot(
    callback: (snapshot: ContextMenuSnapshot) => void,
  ): () => void;
  performAction(action: ContextMenuAction): void;
}

export const IPC = {
  snapshotGet: "usage-pet:snapshot:get",
  snapshotChanged: "usage-pet:snapshot:changed",
  pointerDirection: "usage-pet:pointer:direction",
  panelSetOpen: "usage-pet:panel:set-open",
  dragPrepare: "usage-pet:drag:prepare",
  dragMove: "usage-pet:drag:move",
  dragEnd: "usage-pet:drag:end",
  threadOpen: "usage-pet:thread:open",
  scaleAdjust: "usage-pet:scale:adjust",
  contextMenuShow: "usage-pet:context-menu:show",
  contextMenuSnapshotGet: "usage-pet:context-menu:snapshot:get",
  contextMenuSnapshotChanged:
    "usage-pet:context-menu:snapshot:changed",
  contextMenuAction: "usage-pet:context-menu:action",
  petReaction: "usage-pet:pet:reaction",
} as const;
