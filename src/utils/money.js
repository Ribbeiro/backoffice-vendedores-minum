export function parseMoneyValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const compact = String(value)
    .trim()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/R\$/gi, '')
    .replace(/[^\d.,+-]/g, '');

  const match = compact.match(/^([+-]?)(\d[\d.,]*)$/);
  if (!match) return null;

  const sign = match[1] === '-' ? '-' : '';
  const normalized = normalizeSeparators(match[2]);
  if (!normalized) return null;

  const parsed = Number(`${sign}${normalized}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function expectedRevenueValue(customer) {
  const sourceValue = parseMoneyValue(customer?.expectedRevenue);
  if (sourceValue !== null) return sourceValue;
  return parseMoneyValue(customer?.expectedRevenueValue);
}

function normalizeSeparators(value) {
  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const thousandSeparator = decimalSeparator === '.' ? ',' : '.';
    const withoutThousands = value.split(thousandSeparator).join('');
    const parts = withoutThousands.split(decimalSeparator);
    if (parts.length !== 2 || !parts.every((part) => /^\d+$/.test(part))) return null;
    return `${parts[0]}.${parts[1]}`;
  }

  const separator = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (!separator) return /^\d+$/.test(value) ? value : null;

  const parts = value.split(separator);
  if (!parts.every((part) => /^\d+$/.test(part))) return null;

  if (parts.length === 2) {
    // No contexto monetario do Odoo, tres digitos apos um separador unico
    // representam agrupamento de milhar: 15.000 deve ser 15000, nao 15.
    return parts[1].length === 3 ? parts.join('') : `${parts[0]}.${parts[1]}`;
  }

  if (parts.slice(1).every((part) => part.length === 3)) return parts.join('');

  const fraction = parts.at(-1);
  const integerGroups = parts.slice(0, -1);
  if (fraction.length <= 2 && integerGroups.slice(1).every((part) => part.length === 3)) {
    return `${integerGroups.join('')}.${fraction}`;
  }

  return null;
}
