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
  'Responsavel',
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
  const rawId = readCell(row, 'ID', 'id', 'Id');
  const id = String(rawId || `linha-${index + 1}`).trim();
  const address = clean(readCell(row, 'Deal - Address'));
  const cnpjCpf = clean(readCell(row, '(CPF/CNPJ)', 'CPF/CNPJ', 'CNPJ', 'CPF'));
  const clientName = clean(readCell(row, 'Client - Name'));
  const expectedRevenue = clean(readCell(row, 'Deal - Expected Revenue'));
  const latitude = numberOrNull(readCell(row, 'latitude', 'Latitude', 'lat'));
  const longitude = numberOrNull(readCell(row, 'longitude', 'Longitude', 'lng', 'lon'));
  const pipelineStage = clean(readCell(row, 'Deal - Pipeline Stage'));
  const responsavel = clean(readCell(row, 'Responsavel', 'Responsável', 'ResponsÃ¡vel'));
  const responsableSalesperson = clean(readCell(row, 'Deal - Responsable Salesperson'));
  const opportunity = clean(readCell(row, 'Opportunity'));

  return {
    id,
    opportunity,
    cpfCnpj: cnpjCpf,
    cnpjCpf,
    externalId: id,
    dealAddress: address,
    address,
    email: clean(readCell(row, 'Client - Email')),
    state: normalizeState(readCell(row, 'Client - State', 'State', 'UF', 'Estado')),
    city: clean(readCell(row, 'Cidade', 'City', 'Client - City')),
    phone: clean(readCell(row, 'Client - Phone')),
    segment: clean(readCell(row, 'Deal - Segment')),
    responsible: responsavel,
    responsavel,
    lastUpdate: clean(readCell(row, 'Ultima Atualizacao', 'Última Atualização')),
    ultimaAtualizacao: clean(readCell(row, 'Ultima Atualizacao', 'Última Atualização')),
    distributor: clean(readCell(row, 'Deal - Distributor')),
    responsibleSalesperson: responsableSalesperson,
    responsableSalesperson,
    tags: clean(readCell(row, 'Deal - Tags')),
    expectedRevenue,
    expectedRevenueValue: numberOrNull(expectedRevenue),
    notes: clean(readCell(row, 'Deal - Notes')),
    origin: clean(readCell(row, 'Deal - Origem')),
    origem: clean(readCell(row, 'Deal - Origem')),
    pipelineStage,
    status: pipelineStage,
    name: clientName || opportunity || id,
    clientName,
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    country: clean(readCell(row, 'Country', 'Pais', 'País')),
    active: true,
    raw: excelHeaders.reduce((acc, header) => {
      acc[header] = readCell(row, header);
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = String(value).trim().replace(/\s+/g, '');
  const parsed = Number(
    normalized.includes(',')
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized,
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function readCell(row, ...headers) {
  for (const header of headers) {
    if (row[header] !== undefined && row[header] !== null && row[header] !== '') {
      return row[header];
    }
  }

  const normalizedHeaders = headers.map(normalizeHeader);
  const matchingKey = Object.keys(row).find((key) => normalizedHeaders.includes(normalizeHeader(key)));
  return matchingKey ? row[matchingKey] : '';
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeState(value) {
  const state = clean(value);
  const normalized = normalizeHeader(state);
  const statesByName = {
    acre: 'AC',
    alagoas: 'AL',
    amapa: 'AP',
    amazonas: 'AM',
    bahia: 'BA',
    ceara: 'CE',
    'distrito federal': 'DF',
    'espirito santo': 'ES',
    goias: 'GO',
    maranhao: 'MA',
    'mato grosso': 'MT',
    'mato grosso do sul': 'MS',
    'minas gerais': 'MG',
    para: 'PA',
    paraiba: 'PB',
    parana: 'PR',
    pernambuco: 'PE',
    piaui: 'PI',
    'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN',
    'rio grande do sul': 'RS',
    rondonia: 'RO',
    roraima: 'RR',
    'santa catarina': 'SC',
    'sao paulo': 'SP',
    sergipe: 'SE',
    tocantins: 'TO',
  };

  return statesByName[normalized] || state.toUpperCase();
}
