import { sanitiseModelText } from "@capmap/core";

/** Two spaces keep columns legible without drawing box characters. */
const COLUMN_GAP = "  ";
const LINE_TERMINATOR = "\n";

export interface Table {
  headers: string[];
  rows: string[][];
}

function columnWidths(table: Table): number[] {
  return table.headers.map((header, column) =>
    table.rows.reduce(
      (widest, row) => Math.max(widest, (row[column] ?? "").length),
      header.length,
    ),
  );
}

function renderRow(cells: string[], widths: number[]): string {
  return widths
    .map((width, column) => (cells[column] ?? "").padEnd(width))
    .join(COLUMN_GAP)
    .trimEnd();
}

/**
 * Render a fixed-width table as a single string. Columns are sized to their
 * widest cell so that output stays readable when piped through `less`, and no
 * cell is ever truncated: a capability map that hides part of a name is worse
 * than one that wraps in a narrow terminal. Cells hold text from scanned
 * repositories and the model, so each prints as one line with no control
 * characters: a terminal escape in a directory name must not reach the screen.
 */
export function renderTable(input: Table): string {
  const printable = (cell: string): string => sanitiseModelText(cell, Number.POSITIVE_INFINITY);
  const table = { headers: input.headers.map(printable), rows: input.rows.map((row) => row.map(printable)) };
  const widths = columnWidths(table);
  return [
    renderRow(table.headers, widths),
    ...table.rows.map((row) => renderRow(row, widths)),
  ].join(LINE_TERMINATOR);
}
