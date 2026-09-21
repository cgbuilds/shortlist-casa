import { defaultMatrix } from "@/kb/catalog";
import { applyTool } from "@/lib/matrix-tools";
import type { UserMatrix } from "@/lib/types";

/** First-run home profile so the map has scored homes before they talk to chat. */
export function starterMatrix(): UserMatrix {
  let matrix = applyTool(defaultMatrix(), "set_budget", { searchArea: "Tampa, FL", intent: "buy" }).matrix;
  matrix = applyTool(matrix, "set_dimension", { id: "beds", enabled: true, min: 3, mustHave: true }).matrix;
  matrix = applyTool(matrix, "set_dimension", { id: "baths", enabled: true, min: 2, mustHave: true }).matrix;
  matrix = applyTool(matrix, "set_dimension", {
    id: "property_type",
    enabled: true,
    prefs: { prefer: "sfr" },
  }).matrix;
  return matrix;
}

export function isBlankProfile(matrix: UserMatrix) {
  return !matrix.searchArea?.trim() && !matrix.searchZip?.trim() && !matrix.searchPoint?.trim();
}
