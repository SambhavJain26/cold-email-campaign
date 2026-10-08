/** Resolve a minute-precision wall time without silently selecting a DST offset. */
export function resolveReviewLocalTime(
  local: string,
  timeZone: string,
): { instant: string | null; error: string | null } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    return { instant: null, error: 'Choose a complete date and time.' };
  const target = Date.parse(local + 'Z');
  if (!Number.isFinite(target)) return { instant: null, error: 'Date and time are invalid.' };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return { instant: null, error: 'Use a valid IANA timezone.' };
  }
  const wall = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const v = (name: string) => parts.find((p) => p.type === name)?.value;
    return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
  };
  const offsets = new Set<number>();
  for (let hour = -24; hour <= 24; hour += 3) {
    const probe = target + hour * 3600000;
    offsets.add(Date.parse(wall(probe) + 'Z') - probe);
  }
  const matches = [...offsets]
    .map((offset) => target - offset)
    .filter((candidate) => wall(candidate) === local);
  if (matches.length === 0)
    return {
      instant: null,
      error: 'This local time does not exist because the clocks change. Choose another time.',
    };
  if (matches.length > 1)
    return {
      instant: null,
      error: 'This local time occurs twice because the clocks change. Choose an unambiguous time.',
    };
  return { instant: new Date(matches[0]!).toISOString(), error: null };
}
