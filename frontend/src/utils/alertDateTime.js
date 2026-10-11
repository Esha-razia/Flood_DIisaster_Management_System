// Alerts use UTC in storage. Legacy SQL timestamps omit the UTC suffix.
// Display the same Pakistan date/time throughout the alert interfaces.
export function formatAlertDateTime(value) {
  if (value == null || value === '') return '—';
  let timestamp = value;
  if (typeof value === 'string') {
    timestamp = value.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
      timestamp += 'Z';
    }
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(date);
}
