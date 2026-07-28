import type {
  AppSnapshot,
  PetAnimationState,
  TaskSnapshot,
} from "../shared/contracts.ts";
import {
  updateDragAnimation,
  type DragAnimationState,
} from "./drag-animation.ts";
import { HookSoundGate } from "./hook-sound-gate.ts";
import { getTaskPanelLayout } from "./task-panel-layout.ts";
import { summarizeTasks } from "./task-summary.ts";

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 104;
const DRAG_THRESHOLD = 3;

interface AnimationDefinition {
  row: number;
  durations: readonly number[];
}

const ANIMATIONS: Record<PetAnimationState, AnimationDefinition> = {
  idle: {
    row: 0,
    durations: [280, 110, 110, 140, 140, 320],
  },
  "running-right": {
    row: 1,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  "running-left": {
    row: 2,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  waving: {
    row: 3,
    durations: [140, 140, 140, 280],
  },
  jumping: {
    row: 4,
    durations: [140, 140, 140, 140, 280],
  },
  failed: {
    row: 5,
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  waiting: {
    row: 6,
    durations: [150, 150, 150, 150, 150, 260],
  },
  running: {
    row: 7,
    durations: [120, 120, 120, 120, 120, 220],
  },
  review: {
    row: 8,
    durations: [150, 150, 150, 150, 150, 280],
  },
};

const STATUS_LABELS: Record<TaskSnapshot["status"], string> = {
  running: "运行中",
  waiting: "待回复",
  review: "待查看",
  failed: "失败",
};

const requireElement = <T extends Element>(
  selector: string,
  type: { new (): T },
): T => {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) {
    throw new Error(`Missing required UI element: ${selector}`);
  }
  return element;
};

const mainRow = requireElement("#main-row", HTMLDivElement);
const petZone = requireElement("#pet-zone", HTMLDivElement);
const petAtlas = requireElement("#pet-atlas", HTMLImageElement);
const usageCapsule = requireElement("#usage-capsule", HTMLButtonElement);
const remainingValue = requireElement("#remaining-value", HTMLSpanElement);
const remainingProgress = requireElement(
  "#remaining-progress",
  SVGSVGElement,
);
const remainingProgressValue = requireElement(
  "#remaining-progress-value",
  SVGCircleElement,
);
const resetDate = requireElement("#reset-date", HTMLSpanElement);
const resetMonth = requireElement("#reset-month", HTMLSpanElement);
const resetDay = requireElement("#reset-day", HTMLSpanElement);
const resetDateFallback = requireElement(
  "#reset-date-fallback",
  HTMLSpanElement,
);
const resetWeekday = requireElement("#reset-weekday", HTMLSpanElement);
const runningCount = requireElement("#running-count", HTMLSpanElement);
const completedCount = requireElement("#completed-count", HTMLSpanElement);
const taskPanel = requireElement("#task-panel", HTMLElement);
const taskList = requireElement("#task-list", HTMLDivElement);
const taskCount = requireElement("#task-count", HTMLSpanElement);
const taskEmpty = requireElement("#task-empty", HTMLDivElement);
const liveRegion = requireElement("#live-region", HTMLDivElement);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const hookSound = new Audio("./sounds/hook-notification.mp3");
const hookSoundGate = new HookSoundGate();
hookSound.preload = "auto";

let snapshot: AppSnapshot | null = null;
let businessState: AppSnapshot["primaryState"] = "idle";
let dragState: DragAnimationState | null = null;
let oneShotState: "jumping" | "waving" | null = null;
let pointerDirection: number | null = null;
let animationKey = "";
let animationFrameIndex = 0;
let animationFrameStarted = 0;
let animationRequest = 0;
let renderedTasksKey = "";

const setSpriteCell = (row: number, column: number): void => {
  petAtlas.style.transform = `translate3d(${
    -column * FRAME_WIDTH
  }px, ${-row * FRAME_HEIGHT}px, 0)`;
};

const effectiveAnimation = ():
  | { kind: "direction"; index: number }
  | { kind: "state"; state: PetAnimationState; oneShot: boolean } => {
  if (dragState) {
    return { kind: "state", state: dragState, oneShot: false };
  }
  if (oneShotState) {
    return { kind: "state", state: oneShotState, oneShot: true };
  }
  if (
    businessState === "idle" &&
    snapshot?.pet.spriteVersionNumber === 2 &&
    pointerDirection !== null
  ) {
    return { kind: "direction", index: pointerDirection };
  }
  return { kind: "state", state: businessState, oneShot: false };
};

const runAnimation = (now: number): void => {
  const effective = effectiveAnimation();
  const nextKey =
    effective.kind === "direction"
      ? `direction:${effective.index}`
      : `state:${effective.state}:${effective.oneShot}`;

  if (animationKey !== nextKey) {
    animationKey = nextKey;
    animationFrameIndex = 0;
    animationFrameStarted = now;
  }

  if (effective.kind === "direction") {
    const row = effective.index < 8 ? 9 : 10;
    const column = effective.index % 8;
    setSpriteCell(row, column);
  } else {
    const definition = ANIMATIONS[effective.state];
    setSpriteCell(definition.row, animationFrameIndex);

    if (!reducedMotion.matches) {
      const duration =
        definition.durations[animationFrameIndex] ??
        definition.durations.at(-1) ??
        160;
      if (now - animationFrameStarted >= duration) {
        const isLast =
          animationFrameIndex >= definition.durations.length - 1;
        if (isLast && effective.oneShot) {
          oneShotState = null;
          animationKey = "";
        } else {
          animationFrameIndex = isLast ? 0 : animationFrameIndex + 1;
          animationFrameStarted = now;
        }
      }
    } else if (effective.oneShot) {
      oneShotState = null;
      animationKey = "";
    }
  }

  animationRequest = window.requestAnimationFrame(runAnimation);
};

const restartAnimation = (): void => {
  animationKey = "";
  if (animationRequest === 0) {
    animationRequest = window.requestAnimationFrame(runAnimation);
  }
};

const playReaction = (state: "jumping" | "waving"): void => {
  if (dragState) {
    return;
  }
  oneShotState = state;
  restartAnimation();
  window.usagePet.triggerPetReaction(state);
};

const resetDatePartsFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Singapore",
});

const fullResetFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Singapore",
});

const resetWeekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
  weekday: "long",
  timeZone: "Asia/Singapore",
});

const syncFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Singapore",
});

const setRemainingProgress = (value: number): void => {
  const normalized = Math.min(100, Math.max(0, value));
  remainingProgressValue.style.strokeDashoffset = String(100 - normalized);
  remainingProgress.setAttribute("aria-valuenow", String(normalized));
};

const showResetDateFallback = (
  label: string,
  secondaryLabel: string,
): void => {
  resetDate.hidden = true;
  resetDateFallback.hidden = false;
  resetDateFallback.textContent = label;
  resetWeekday.textContent = secondaryLabel;
};

const showResetDate = (resetTime: Date): void => {
  const parts = resetDatePartsFormatter.formatToParts(resetTime);
  resetMonth.textContent =
    parts.find((part) => part.type === "month")?.value ?? "—";
  resetDay.textContent =
    parts.find((part) => part.type === "day")?.value ?? "—";
  resetDate.hidden = false;
  resetDateFallback.hidden = true;
  resetWeekday.textContent = resetWeekdayFormatter.format(resetTime);
};

const renderUsage = (nextSnapshot: AppSnapshot): void => {
  const { usage } = nextSnapshot;
  usageCapsule.dataset.status = usage.status;

  if (!usage.weekly || usage.status === "unavailable") {
    remainingValue.textContent = "—";
    setRemainingProgress(0);
    showResetDateFallback("暂不可用", "周额度");
    usageCapsule.title = usage.reason ?? "暂时无法读取 Codex 周用量";
    return;
  }

  if (usage.status === "stale") {
    const remainingPercent = Math.round(
      usage.weekly.remainingPercent,
    );
    remainingValue.textContent = String(remainingPercent);
    setRemainingProgress(remainingPercent);
    showResetDateFallback("待刷新", "额度已重置");
    usageCapsule.title = `上次读取 ${syncFormatter.format(
      new Date(usage.weekly.capturedAt),
    )}；额度窗口已重置，等待 Codex 写入新数据`;
    return;
  }

  const remainingPercent = Math.round(
    usage.weekly.remainingPercent,
  );
  remainingValue.textContent = String(remainingPercent);
  setRemainingProgress(remainingPercent);
  const resetTime = new Date(usage.weekly.resetsAt * 1_000);
  showResetDate(resetTime);
  usageCapsule.title = `周用量剩余 ${Math.round(
    usage.weekly.remainingPercent,
  )}%；${fullResetFormatter.format(resetTime)} 重置；${syncFormatter.format(
    new Date(usage.weekly.capturedAt),
  )} 读取`;
};

const formatAge = (updatedAt: number): string => {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.floor(hours / 24)} 天前`;
};

const createTaskItem = (task: TaskSnapshot): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-item interactive";
  button.dataset.status = task.status;
  button.disabled = !task.canOpen;
  button.setAttribute(
    "aria-label",
    `${task.title}，${STATUS_LABELS[task.status]}${
      task.canOpen ? "，在 Codex 中打开" : ""
    }`,
  );

  const icon = document.createElement("span");
  icon.className = "task-status-icon";
  icon.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.className = "task-copy";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  const meta = document.createElement("span");
  meta.className = "task-meta";
  meta.textContent = [task.workspaceName, formatAge(task.updatedAt)]
    .filter(Boolean)
    .join(" · ");

  const state = document.createElement("span");
  state.className = "task-state-label";
  state.textContent = STATUS_LABELS[task.status];

  copy.append(title, meta);
  button.append(icon, copy, state);

  button.addEventListener("click", async () => {
    if (!task.canOpen) {
      return;
    }
    const opened = await window.usagePet.openThread(task.id);
    if (!opened) {
      liveRegion.textContent = "已尝试唤醒 Codex，但未能确认任务跳转";
    }
  });

  return button;
};

const renderTasks = (nextSnapshot: AppSnapshot): void => {
  const summary = summarizeTasks(nextSnapshot.tasks);
  const layout = getTaskPanelLayout(nextSnapshot.tasks.length);
  runningCount.textContent = String(summary.running);
  completedCount.textContent = String(summary.completed);
  taskPanel.style.setProperty(
    "--panel-height",
    `${layout.panelHeight}px`,
  );
  taskList.style.setProperty(
    "--task-list-max-height",
    `${layout.taskListMaxHeight}px`,
  );

  const nextTasksKey = JSON.stringify(
    nextSnapshot.tasks.map((task) => [
      task.id,
      task.title,
      task.workspaceName,
      task.status,
      task.canOpen,
      formatAge(task.updatedAt),
    ]),
  );
  if (nextTasksKey === renderedTasksKey) {
    return;
  }
  renderedTasksKey = nextTasksKey;
  taskList.replaceChildren(
    ...nextSnapshot.tasks.map((task) => createTaskItem(task)),
  );
  taskCount.textContent = String(nextSnapshot.tasks.length);
  taskEmpty.hidden = nextSnapshot.tasks.length !== 0;
};

const renderPanel = (nextSnapshot: AppSnapshot): void => {
  taskPanel.hidden = !nextSnapshot.panelOpen;
  usageCapsule.setAttribute(
    "aria-expanded",
    String(nextSnapshot.panelOpen),
  );
};

const renderSnapshot = (nextSnapshot: AppSnapshot): void => {
  const previousState = businessState;
  snapshot = nextSnapshot;
  businessState = nextSnapshot.primaryState;

  if (hookSoundGate.update(nextSnapshot.notificationTasks)) {
    hookSound.currentTime = 0;
    void hookSound.play().catch(() => {
      // Sound is optional feedback and must never block state rendering.
    });
  }

  document.documentElement.style.setProperty(
    "--ui-scale",
    String(nextSnapshot.scale),
  );

  if (petAtlas.src !== nextSnapshot.pet.assetUrl) {
    petAtlas.src = nextSnapshot.pet.assetUrl;
  }
  petAtlas.style.height = `${
    nextSnapshot.pet.atlasHeight / 2
  }px`;

  renderUsage(nextSnapshot);
  renderTasks(nextSnapshot);
  renderPanel(nextSnapshot);

  if (previousState !== businessState) {
    liveRegion.textContent =
      businessState === "idle"
        ? "Codex 当前空闲"
        : `Codex 状态：${
            businessState === "running"
              ? "运行中"
              : businessState === "waiting"
                ? "等待回复"
                : businessState === "review"
                  ? "等待查看"
                  : businessState === "failed"
                    ? "失败"
                    : businessState
          }`;
  }
  restartAnimation();
};

interface ActivePointer {
  pointerId: number;
  startX: number;
  startY: number;
  lastScreenX: number;
  dragging: boolean;
  startedOnPet: boolean;
}

let activePointer: ActivePointer | null = null;

mainRow.addEventListener("pointerdown", (event) => {
  if (
    event.button !== 0 ||
    activePointer ||
    (event.target instanceof Element &&
      event.target.closest(".interactive"))
  ) {
    return;
  }

  activePointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastScreenX: event.screenX,
    dragging: false,
    startedOnPet:
      event.target instanceof Element &&
      event.target.closest("#pet-zone") !== null,
  };
  mainRow.setPointerCapture(event.pointerId);
  window.usagePet.prepareDrag();
});

mainRow.addEventListener("pointermove", (event) => {
  if (!activePointer || activePointer.pointerId !== event.pointerId) {
    return;
  }

  const distance = Math.hypot(
    event.clientX - activePointer.startX,
    event.clientY - activePointer.startY,
  );
  if (!activePointer.dragging && distance >= DRAG_THRESHOLD) {
    activePointer.dragging = true;
    mainRow.classList.add("dragging");
  }

  if (!activePointer.dragging) {
    return;
  }

  const horizontalDelta = event.screenX - activePointer.lastScreenX;
  const dragAnimation = updateDragAnimation(
    dragState,
    horizontalDelta,
  );
  dragState = dragAnimation.state;
  if (dragAnimation.changed) {
    restartAnimation();
  }
  activePointer.lastScreenX = event.screenX;
  window.usagePet.moveDrag();
});

const finishPointer = (event?: PointerEvent): void => {
  if (
    !activePointer ||
    (event && activePointer.pointerId !== event.pointerId)
  ) {
    return;
  }

  const completed = activePointer;
  activePointer = null;
  if (
    mainRow.hasPointerCapture(completed.pointerId)
  ) {
    mainRow.releasePointerCapture(completed.pointerId);
  }
  mainRow.classList.remove("dragging");
  dragState = null;
  window.usagePet.endDrag();

  if (!completed.dragging && completed.startedOnPet) {
    playReaction("jumping");
  }
  restartAnimation();
};

mainRow.addEventListener("pointerup", finishPointer);
mainRow.addEventListener("pointercancel", finishPointer);
mainRow.addEventListener("lostpointercapture", () => finishPointer());
window.addEventListener("blur", () => finishPointer());

petZone.addEventListener("dblclick", (event) => {
  if (
    event.target instanceof Element &&
    event.target.closest(".interactive")
  ) {
    return;
  }
  playReaction("waving");
});

usageCapsule.addEventListener("click", () => {
  const nextOpen =
    usageCapsule.getAttribute("aria-expanded") !== "true";
  usageCapsule.setAttribute("aria-expanded", String(nextOpen));
  taskPanel.hidden = !nextOpen;
  window.usagePet.setPanelOpen(nextOpen);
});

window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    window.usagePet.adjustScale(event.deltaY < 0 ? 0.1 : -0.1);
  },
  { passive: false },
);

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.usagePet.showContextMenu();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && snapshot?.panelOpen) {
    window.usagePet.setPanelOpen(false);
  }
});

reducedMotion.addEventListener("change", restartAnimation);

window.usagePet.onSnapshot(renderSnapshot);
window.usagePet.onPointerDirection(({ directionIndex }) => {
  if (
    directionIndex !== null &&
    (!Number.isInteger(directionIndex) ||
      directionIndex < 0 ||
      directionIndex > 15)
  ) {
    return;
  }
  pointerDirection = directionIndex;
  restartAnimation();
});

void window.usagePet
  .getSnapshot()
  .then((initialSnapshot) => {
    renderSnapshot(initialSnapshot);
    playReaction("waving");
  })
  .catch(() => {
    remainingValue.textContent = "—";
    setRemainingProgress(0);
    showResetDateFallback("暂不可用", "周额度");
    usageCapsule.dataset.status = "unavailable";
  });

restartAnimation();
