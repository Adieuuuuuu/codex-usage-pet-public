export interface PointLike {
  x: number;
  y: number;
}

export const directionIndexFromPoints = (
  cursor: PointLike,
  center: PointLike,
  deadzone: number,
): number | null => {
  const horizontal = cursor.x - center.x;
  const vertical = cursor.y - center.y;
  if (Math.hypot(horizontal, vertical) <= deadzone) {
    return null;
  }
  const degrees =
    ((Math.atan2(horizontal, -vertical) * 180) / Math.PI + 360) % 360;
  return Math.round(degrees / 22.5) % 16;
};
