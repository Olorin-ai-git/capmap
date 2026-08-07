import { scoreRisk } from "../src/index.js";

export function exercise(): boolean {
  return scoreRisk(2, 3) === 6;
}
