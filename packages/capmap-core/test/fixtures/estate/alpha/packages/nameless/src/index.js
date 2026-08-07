// A manifest with no `name` field. The scanner falls back to the directory
// basename; verification must apply the same fallback or it reports drift on a
// package that has not changed.
export function computeTotal(values) {
  return values.reduce((sum, value) => sum + value, 0);
}
