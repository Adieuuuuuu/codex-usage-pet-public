(() => {
  const snapshotListeners = new Set();
  const pointerListeners = new Set();
  const reset = Math.floor(Date.now() / 1_000) + 6 * 24 * 60 * 60;
  const requestedTaskCount = Number(
    new URLSearchParams(window.location.search).get("tasks"),
  );
  const fixtureTaskCount =
    Number.isInteger(requestedTaskCount) &&
    requestedTaskCount >= 0 &&
    requestedTaskCount <= 11
      ? requestedTaskCount
      : 3;
  const taskTemplates = [
    {
      title: "整理本周学习笔记",
      workspaceName: "示例工作区",
      status: "running",
    },
    {
      title: "检查演示应用状态",
      workspaceName: "示例工作区",
      status: "waiting",
    },
    {
      title: "确认发布前检查清单",
      workspaceName: "公共示例",
      status: "review",
    },
  ];
  const fixtureTasks = Array.from(
    { length: fixtureTaskCount },
    (_, index) => ({
      id: `019f9e6d-7d8b-77d3-a573-8cbc293afe${String(
        16 + index,
      ).padStart(2, "0")}`,
      title: taskTemplates[index]?.title ?? `演示任务 ${index + 1}`,
      workspaceName:
        taskTemplates[index]?.workspaceName ?? "示例工作区",
      status: taskTemplates[index]?.status ?? "review",
      updatedAt: Date.now() - index * 42_000,
      canOpen: true,
    }),
  );
  let snapshot = {
    pet: {
      id: "zhima-3",
      displayName: "芝麻 3",
      description: "Visual fixture",
      spriteVersionNumber: 2,
      atlasWidth: 1536,
      atlasHeight: 2288,
      frameWidth: 192,
      frameHeight: 208,
      assetUrl: "../../assets/pets/zhima-3/spritesheet.webp",
    },
    primaryState: "running",
    usage: {
      status: "available",
      weekly: {
        remainingPercent: 77,
        usedPercent: 23,
        windowDurationMins: 10080,
        resetsAt: reset,
        capturedAt: new Date().toISOString(),
        source: "rollout",
      },
    },
    tasks: [],
    notificationTasks: [],
    scale: 1,
    panelOpen: false,
    codexRunning: true,
    hookMode: "fallback",
  };

  snapshot = {
    ...snapshot,
    tasks: fixtureTasks,
    notificationTasks: fixtureTasks.map(({ id, status }) => ({
      id,
      status,
    })),
  };

  const publish = () => {
    for (const listener of snapshotListeners) {
      listener(structuredClone(snapshot));
    }
  };

  Object.defineProperty(window, "usagePet", {
    configurable: false,
    value: {
      getSnapshot: async () => structuredClone(snapshot),
      onSnapshot: (listener) => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
      },
      onPointerDirection: (listener) => {
        pointerListeners.add(listener);
        return () => pointerListeners.delete(listener);
      },
      setPanelOpen: (open) => {
        snapshot = { ...snapshot, panelOpen: open };
        publish();
      },
      prepareDrag: () => {},
      moveDrag: () => {},
      endDrag: () => {},
      openThread: async () => true,
      adjustScale: (delta) => {
        snapshot = {
          ...snapshot,
          scale: Math.max(0.55, Math.min(1.6, snapshot.scale + delta)),
        };
        publish();
      },
      showContextMenu: () => {},
      triggerPetReaction: () => {},
    },
  });

  window.setTimeout(() => {
    for (const listener of pointerListeners) {
      listener({ directionIndex: 4 });
    }
  }, 600);
})();
