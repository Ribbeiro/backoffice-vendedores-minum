import { normalizeDate, todayKey } from './formatters';

export const excelHeaders = [
  'Opportunity',
  '(CPF/CNPJ)',
  'ID',
  'Deal - Address',
  'Client - Email',
  'Client - State',
  'Cidade',
  'Client - Phone',
  'Deal - Segment',
  'Responsável',
  'Ultima Atualizacao',
  'Deal - Distributor',
  'Deal - Responsable Salesperson',
  'Deal - Tags',
  'Deal - Expected Revenue',
  'Deal - Notes',
  'Deal - Origem',
  'Deal - Pipeline Stage',
  'Client - Name',
  'latitude',
  'longitude',
  'Country',
];

export function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.entries(value).map(([id, item]) => ({ id, ...item }));
}

export function normalizeCustomer(row, index) {
  const rawId = row.ID || row.id || row.Id;
  const id = String(rawId || `linha-${index + 1}`).trim();
  const address = clean(row['Deal - Address']);
  const cnpjCpf = clean(row['(CPF/CNPJ)']);
  const clientName = clean(row['Client - Name']);
  const expectedRevenue = clean(row['Deal - Expected Revenue']);
  const latitude = numberOrNull(row.latitude);
  const longitude = numberOrNull(row.longitude);
  const pipelineStage = clean(row['Deal - Pipeline Stage']);
  const responsavel = clean(row.Responsável);
  const responsableSalesperson = clean(row['Deal - Responsable Salesperson']);

  return {
    id,
    opportunity: clean(row.Opportunity),
    cpfCnpj: cnpjCpf,
    cnpjCpf,
    externalId: id,
    dealAddress: address,
    address,
    email: clean(row['Client - Email']),
    state: clean(row['Client - State']),
    city: clean(row.Cidade),
    phone: clean(row['Client - Phone']),
    segment: clean(row['Deal - Segment']),
    responsible: responsavel,
    responsavel,
    lastUpdate: clean(row['Ultima Atualizacao']),
    ultimaAtualizacao: clean(row['Ultima Atualizacao']),
    distributor: clean(row['Deal - Distributor']),
    responsibleSalesperson: responsableSalesperson,
    responsableSalesperson,
    tags: clean(row['Deal - Tags']),
    expectedRevenue,
    expectedRevenueValue: numberOrNull(expectedRevenue),
    notes: clean(row['Deal - Notes']),
    origin: clean(row['Deal - Origem']),
    origem: clean(row['Deal - Origem']),
    pipelineStage,
    status: pipelineStage,
    name: clientName || clean(row.Opportunity) || id,
    clientName,
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    country: clean(row.Country),
    active: true,
    raw: excelHeaders.reduce((acc, header) => {
      acc[header] = row[header] ?? '';
      return acc;
    }, {}),
  };
}

export function calculateMetrics({ customers, routes, sellers, routeStops }) {
  const activeSellers = sellers.filter(isUserAllowed);
  const today = todayKey();
  const visitsToday = Object.values(routeStops).flatMap((stops) => asArray(stops)).filter((stop) => {
    const date = normalizeDate(stop.visitedAt || stop.arrivalTime || stop.createdAt || stop.timestamp);
    return date ? todayKey(date) === today : false;
  });

  return {
    totalCustomers: customers.length,
    totalRoutes: routes.length,
    activeSellers: activeSellers.length,
    visitsToday: visitsToday.length,
  };
}

export function buildLast7DaysVisits(routeStops) {
  const labels = [];
  const counts = {};
  const now = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const key = todayKey(date);
    labels.push(key);
    counts[key] = 0;
  }

  Object.values(routeStops).flatMap((stops) => asArray(stops)).forEach((stop) => {
    const date = normalizeDate(stop.visitedAt || stop.arrivalTime || stop.createdAt || stop.timestamp);
    if (!date) return;
    const key = todayKey(date);
    if (counts[key] !== undefined) counts[key] += 1;
  });

  return {
    labels: labels.map((key) => key.slice(5).split('-').reverse().join('/')),
    values: labels.map((key) => counts[key]),
  };
}

export function getLastVisitForSeller(uid, routes, routeStops) {
  const sellerRoutes = routes.filter((route) => route.sellerUid === uid || route.vendedor === uid || route.uid === uid);
  const dates = sellerRoutes.flatMap((route) => {
    const stops = asArray(routeStops[route.id]);
    return [
      route.completedAt,
      route.createdAt,
      route.createdAtTimestamp,
      ...stops.map((stop) => stop.visitedAt || stop.arrivalTime || stop.timestamp),
    ];
  });

  return dates
    .map(normalizeDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

export function isUserAllowed(user) {
  return user?.active === true && user?.allowedAccess === true && user?.deleted !== true;
}

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
