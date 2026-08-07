import { Button } from "@alpha/ui-kit";

export function mount(root: { innerHTML: string }): void {
  root.innerHTML = Button("open console");
}
