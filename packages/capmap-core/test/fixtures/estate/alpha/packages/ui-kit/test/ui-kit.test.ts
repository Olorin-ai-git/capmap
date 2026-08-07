import { Button, Modal, useTheme } from "../src/index.js";

export function exercise(): boolean {
  return (
    Button("ok").length > 0 &&
    new Modal("t").render().length > 0 &&
    useTheme("dark").name === "dark"
  );
}
