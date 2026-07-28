import type {
  ContextMenuAction,
  ContextMenuSnapshot,
} from "../shared/contracts.ts";

const requireElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing context menu element: ${id}`);
  }
  return element as T;
};

const mainMenu = requireElement<HTMLElement>("main-menu");
const petMenu = requireElement<HTMLElement>("pet-menu");
const petOptions = requireElement<HTMLElement>("pet-options");
const visibilityAction =
  requireElement<HTMLButtonElement>("visibility-action");
const shrinkAction =
  requireElement<HTMLButtonElement>("shrink-action");
const growAction = requireElement<HTMLButtonElement>("grow-action");
const resetAction = requireElement<HTMLButtonElement>("reset-action");
const petsAction = requireElement<HTMLButtonElement>("pets-action");
const refreshAction =
  requireElement<HTMLButtonElement>("refresh-action");
const startupAction =
  requireElement<HTMLButtonElement>("startup-action");
const startupCheck = requireElement<HTMLElement>("startup-check");
const phoneSyncAction =
  requireElement<HTMLButtonElement>("phone-sync-action");
const codexAction = requireElement<HTMLButtonElement>("codex-action");
const quitAction = requireElement<HTMLButtonElement>("quit-action");
const petBackAction =
  requireElement<HTMLButtonElement>("pet-back-action");

let snapshot: ContextMenuSnapshot | null = null;

const perform = (action: ContextMenuAction): void => {
  window.usagePetContextMenu.performAction(action);
};

const showMainMenu = (): void => {
  petMenu.hidden = true;
  mainMenu.hidden = false;
  petsAction.focus();
};

const showPetMenu = (): void => {
  mainMenu.hidden = true;
  petMenu.hidden = false;
  petBackAction.focus();
};

const renderPetOptions = (next: ContextMenuSnapshot): void => {
  petOptions.replaceChildren();
  for (const pet of next.pets) {
    const button = document.createElement("button");
    const check = document.createElement("span");
    const label = document.createElement("span");
    const selected = pet.id === next.selectedPetId;

    button.className = "menu-item";
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(selected));
    check.className = "check";
    check.dataset.checked = String(selected);
    label.textContent = pet.displayName;
    button.append(check, label);
    button.addEventListener("click", () => {
      perform({ type: "select-pet", petId: pet.id });
    });
    petOptions.append(button);
  }
};

const renderSnapshot = (next: ContextMenuSnapshot): void => {
  snapshot = next;
  visibilityAction.firstElementChild!.textContent = next.petVisible
    ? "隐藏桌宠"
    : "显示桌宠";
  shrinkAction.disabled = next.scale <= next.minimumScale;
  growAction.disabled = next.scale >= next.maximumScale;
  resetAction.disabled = Math.abs(next.scale - 1) < 0.001;
  startupAction.setAttribute(
    "aria-checked",
    String(next.startupEnabled),
  );
  startupCheck.dataset.checked = String(next.startupEnabled);
  phoneSyncAction.firstElementChild!.textContent =
    next.phoneSyncStatus === "active"
      ? "手机同步已开启"
      : next.phoneSyncStatus === "publishing" ||
          next.phoneSyncStatus === "offline"
        ? "手机同步连接中"
        : next.phoneSyncStatus === "auth-failed"
          ? "手机同步需重新配对"
          : next.phoneSyncStatus === "unavailable"
            ? "连接手机（待部署）"
            : "连接手机";
  renderPetOptions(next);
};

visibilityAction.addEventListener("click", () =>
  perform({ type: "hide-pet" }),
);
shrinkAction.addEventListener("click", () =>
  perform({ type: "adjust-scale", delta: -0.1 }),
);
growAction.addEventListener("click", () =>
  perform({ type: "adjust-scale", delta: 0.1 }),
);
resetAction.addEventListener("click", () =>
  perform({ type: "reset-scale" }),
);
petsAction.addEventListener("click", showPetMenu);
refreshAction.addEventListener("click", () =>
  perform({ type: "refresh-pets" }),
);
startupAction.addEventListener("click", () =>
  perform({ type: "toggle-startup" }),
);
phoneSyncAction.addEventListener("click", () =>
  perform({ type: "phone-sync" }),
);
codexAction.addEventListener("click", () =>
  perform({ type: "open-codex" }),
);
quitAction.addEventListener("click", () => perform({ type: "quit" }));
petBackAction.addEventListener("click", showMainMenu);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    perform({ type: "dismiss" });
    return;
  }
  if (event.key === "ArrowLeft" && !petMenu.hidden) {
    event.preventDefault();
    showMainMenu();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  const view = petMenu.hidden ? mainMenu : petMenu;
  const items = Array.from(
    view.querySelectorAll<HTMLButtonElement>(
      ".menu-item:not(:disabled)",
    ),
  );
  const current = items.indexOf(
    document.activeElement as HTMLButtonElement,
  );
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex =
    (current + direction + items.length) % items.length;
  items[nextIndex]?.focus();
  event.preventDefault();
});

window.usagePetContextMenu.onSnapshot(renderSnapshot);
void window.usagePetContextMenu
  .getSnapshot()
  .then((initialSnapshot) => {
    renderSnapshot(initialSnapshot);
    visibilityAction.focus();
  })
  .catch(() => {
    if (snapshot === null) {
      perform({ type: "dismiss" });
    }
  });
