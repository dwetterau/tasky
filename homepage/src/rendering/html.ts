export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function safeLink(value: string, allowedOrigin?: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (allowedOrigin && url.origin !== allowedOrigin)) return "#";
    return escapeHtml(url.toString());
  } catch { return "#"; }
}
export function sourceTime(at: number | null, timezone: string) {
  if (at === null) return "Awaiting first update";
  return `<time datetime="${new Date(at).toISOString()}">${escapeHtml(new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at))}</time>`;
}
