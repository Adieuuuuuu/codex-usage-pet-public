const TASK_ROW_HEIGHT = 52;
const TASK_ROW_GAP = 7;
const PANEL_CHROME_HEIGHT = 58;
const MAX_VISIBLE_TASKS = 10;

export interface TaskPanelLayout {
  panelHeight: number;
  taskListMaxHeight: number;
  visibleTaskCount: number;
}

export const getTaskPanelLayout = (
  taskCount: number,
): TaskPanelLayout => {
  const normalizedCount = Number.isFinite(taskCount)
    ? Math.max(0, Math.floor(taskCount))
    : 0;
  const visibleTaskCount = Math.min(
    MAX_VISIBLE_TASKS,
    Math.max(1, normalizedCount),
  );
  const taskListMaxHeight =
    visibleTaskCount * TASK_ROW_HEIGHT +
    (visibleTaskCount - 1) * TASK_ROW_GAP;

  return {
    panelHeight: PANEL_CHROME_HEIGHT + taskListMaxHeight,
    taskListMaxHeight,
    visibleTaskCount,
  };
};
