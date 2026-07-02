export function formatDateTime(value) {
  if (!value) return '-';
  const date = normalizeDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '-';
  const date = normalizeDate(value);
  if (!date) return '-';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

export function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const normalized = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function currencyBRL(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(number);
}

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
