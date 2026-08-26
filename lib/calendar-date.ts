export function parseAsCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const datetimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      input
    );
  if (datetimeMatch) {
    const hasTZ = !!datetimeMatch[8];
    if (hasTZ) {
      const d = new Date(input);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const year = Number(datetimeMatch[1]);
    const month = Number(datetimeMatch[2]);
    const day = Number(datetimeMatch[3]);
    const hour = Number(datetimeMatch[4]);
    const minute = Number(datetimeMatch[5]);
    const second = datetimeMatch[6] ? Number(datetimeMatch[6]) : 0;
    const d = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatCalendarDateShort(value: string | null | undefined) {
  const d = parseAsCalendarDate(value);
  if (!d) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
}

export function formatCalendarDateLong(value: string | null | undefined) {
  const d = parseAsCalendarDate(value);
  if (!d) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}
