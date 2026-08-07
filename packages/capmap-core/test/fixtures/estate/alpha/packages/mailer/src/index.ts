export function sendTemplated(
  template: string,
  to: string,
): { template: string; to: string } {
  return { template, to };
}
