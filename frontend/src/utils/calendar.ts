/* RFC 5545：只导出调用方已确认的精确时间；按 UTF-8 字节折行，阻止内容注入属性。 */
export function calendarFile(entries: { id: string; at: string; title: string; description?: string }[]): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Codex Reset Monitor//Personal Calendar//EN", "CALSCALE:GREGORIAN"];
  for (const entry of entries) {
    if (!Number.isFinite(Date.parse(entry.at))) continue;
    lines.push("BEGIN:VEVENT", `UID:${escape(entry.id)}@codex-reset-monitor.local`, `DTSTAMP:${stamp(new Date().toISOString())}`, `DTSTART:${stamp(entry.at)}`, `SUMMARY:${escape(entry.title)}`, `DESCRIPTION:${escape(entry.description || "")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const encoder = new TextEncoder();
  return lines.map(line => {
    let current = "", bytes = 0; const folded = [];
    for (const char of line) { const size = encoder.encode(char).length; if (bytes + size > 75) { folded.push(current); current = " "; bytes = 1; } current += char; bytes += size; }
    folded.push(current); return folded.join("\r\n");
  }).join("\r\n") + "\r\n";
}
export function downloadCalendar(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
