export const Button = (label: string): string => `<button>${label}</button>`;

export class Modal {
  constructor(readonly title: string) {}

  render(): string {
    return `<dialog>${this.title}</dialog>`;
  }
}

export function useTheme(name: string): { name: string } {
  return { name };
}
