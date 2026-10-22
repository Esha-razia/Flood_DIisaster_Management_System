// Alerts use UTC in storage. Legacy SQL timestamps omit the UTC suffix.
// Display the same Pakistan date/time throughout the alert interfaces.
export function normalizeTimestamp(value) {
  if (value == null || value === '') return '';
  let timestamp = String(value).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
    timestamp += 'Z';
  }
  return timestamp;
}

export function parseTimestampMs(value) {
  const norm = normalizeTimestamp(value);
  if (!norm) return 0;
  const t = new Date(norm).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function formatAlertDateTime(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
}
