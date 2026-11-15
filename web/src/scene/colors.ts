// The 3D scenes take their colours from the CSS variables in styles/theme.css,
// so there is still only one place where colours are defined.

const cache = new Map<string, string>();

export function cssColor(name: string, fallbackVar = '--ch-ink'): string {
  const key = name;
  const hit = cache.get(key);
  if (hit) return hit;
  let value = '';
  if (typeof document !== 'undefined') {
    const styles = getComputedStyle(document.documentElement);
    value = styles.getPropertyValue(name).trim() || styles.getPropertyValue(fallbackVar).trim();
  }
  if (value) cache.set(key, value);
  return value || 'gray';
}
