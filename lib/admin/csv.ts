/**
 * CSV for spreadsheets. Cells are quoted, and a cell that starts like a formula (=, +, -, @) is
 * prefixed with ' so a spreadsheet shows it as text and never runs it.
 */
export function toCsv(
  header: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const cell = (v: string | number | boolean | null): string => {
    let s = v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
