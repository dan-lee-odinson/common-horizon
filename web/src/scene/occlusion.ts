// Is a point in the Moon world hidden behind the Moon, as seen from the camera?
// Used to hide the Sun's and Earth's labels (and their leader lines) while the body is behind the Moon.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** True when the straight line from `from` to `to` passes through the Moon (a sphere of `radius` at the origin). */
export function hiddenByMoon(from: Point3, to: Point3, radius = 1): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return false;
  const b = 2 * (from.x * dx + from.y * dy + from.z * dz);
  const c = from.x * from.x + from.y * from.y + from.z * from.z - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}
