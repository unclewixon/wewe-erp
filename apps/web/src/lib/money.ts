/** Kobo string → "₦1,250,000.00". The only place money becomes text. */
export function naira(kobo: string | bigint): string {
  const k = typeof kobo === 'bigint' ? kobo : BigInt(kobo || '0');
  const negative = k < 0n;
  const abs = negative ? -k : k;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₦${withCommas}.${cents}`;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Lagos' });
}

export function timeAgo(d: string | Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
