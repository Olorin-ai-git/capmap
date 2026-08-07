export function scoreRisk(exposure: number, weight: number): number {
  return exposure * weight;
}
