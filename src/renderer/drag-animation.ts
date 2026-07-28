export type DragAnimationState = "running-left" | "running-right";

export interface DragAnimationUpdate {
  state: DragAnimationState | null;
  changed: boolean;
}

export const updateDragAnimation = (
  current: DragAnimationState | null,
  horizontalDelta: number,
): DragAnimationUpdate => {
  if (horizontalDelta === 0) {
    return { state: current, changed: false };
  }

  const state =
    horizontalDelta > 0 ? "running-right" : "running-left";
  return {
    state,
    changed: state !== current,
  };
};
