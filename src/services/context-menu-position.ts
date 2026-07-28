export interface ContextMenuPoint {
  x: number;
  y: number;
}

export interface ContextMenuRectangle extends ContextMenuPoint {
  width: number;
  height: number;
}

export interface ContextMenuSize {
  width: number;
  height: number;
}

export const CONTEXT_MENU_WINDOW_SIZE: ContextMenuSize = {
  width: 286,
  height: 414,
};

const MENU_GAP = 6;
const MENU_TOP_OFFSET = 12;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

export const positionContextMenu = (
  anchor: ContextMenuPoint,
  workArea: ContextMenuRectangle,
  size: ContextMenuSize = CONTEXT_MENU_WINDOW_SIZE,
): ContextMenuPoint => {
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const preferredRight = anchor.x + MENU_GAP;
  const preferredLeft = anchor.x - MENU_GAP - size.width;
  const x =
    preferredRight + size.width <= right
      ? preferredRight
      : preferredLeft;

  return {
    x: clamp(x, workArea.x, Math.max(workArea.x, right - size.width)),
    y: clamp(
      anchor.y - MENU_TOP_OFFSET,
      workArea.y,
      Math.max(workArea.y, bottom - size.height),
    ),
  };
};
