import { Button } from "@alpha/ui-kit";
import { createSession } from "@alpha/auth";

export function boot(): void {
  createSession();
  Button();
}
