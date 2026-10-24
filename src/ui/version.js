// Which build this is, for the line under the title: "build 263 | 24.10.2026
// um 01:30". The number and the time come from version.json, which the
// Pages build writes next to the page and the development server answers
// from git; a page with neither says so rather than making one up.

/**
 * @param {{build?:string|number, time?:string}|null} v what version.json held
 * @returns {string}
 */
export function buildLine(v) {
  if (!v || !v.time) return `build ${v && v.build ? v.build : 'dev'}`;
  const t = new Date(v.time);
  if (Number.isNaN(t.getTime())) return `build ${v.build || 'dev'}`;
  // Berlin's own clock, summer time and all, whatever the visitor's is.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((p) => [p.type, p.value]));
  return `build ${v.build || 'dev'} | ${parts.day}.${parts.month}.${parts.year} um ${parts.hour}:${parts.minute}`;
}

/** Fetches version.json and returns its line, or a plain one if it is not there. */
export async function loadBuildLine(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('version.json', { cache: 'no-store' });
    if (!res.ok) return buildLine(null);
    return buildLine(await res.json());
  } catch {
    return buildLine(null);
  }
}
