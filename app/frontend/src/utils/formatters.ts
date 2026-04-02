/**
 * Money formatting utility
 */
export function formatMoney(amount: number | null | undefined, currency = 'PLN'): string {
  if (amount === null || amount === undefined) return '-';
  return `${Number(amount).toFixed(2)} ${currency}`;
}

/**
 * Date formatting utility - Polish locale
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('pl-PL');
  } catch {
    return '-';
  }
}

/**
 * Percentage formatting utility
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return (value * 100).toFixed(2) + '%';
}

/**
 * Number formatting with thousands separator
 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}
