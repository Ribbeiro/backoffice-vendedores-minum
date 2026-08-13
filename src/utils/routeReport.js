import { asArray } from './helpers';
import { normalizeDate } from './formatters';
import {
  buildCustomerLookup,
  customerForStop,
  feedbackDistanceFromCustomer,
} from './locationDistance';
import { buildRouteTelemetry, stopVisitDurationSeconds } from './routeTelemetry';
import { attendanceDurationSeconds, attendancesForStop, completedAttendancesForStop } from './routeAttendances';

const REPORTED_STOP_STATUSES = new Set(['visited', 'not_visited']);

/**
 * Monta uma visao unica das rotas para a interface e para a exportacao.
 * A fonte continua sendo o Firebase em tempo real; este modulo apenas
 * transforma os dados em indicadores que a gestao consegue comparar.
 */
export function buildRouteReport({ customers, routes, routeStops, users, visitEvents, filters }) {
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const customersByKey = buildCustomerLookup(customers);
  const telemetryByRoute = new Map(
    buildRouteTelemetry(routes, routeStops, visitEvents)
      .map((item) => [String(item.routeId), item]),
  );

  const allRoutes = routes
    .map((route) => buildRouteRow({
      route,
      routeStops,
      usersById,
      customersByKey,
      telemetry: telemetryByRoute.get(String(route.id)),
    }))
    .sort((first, second) => routeTimestamp(second.routeDate) - routeTimestamp(first.routeDate));

  const filteredRoutes = allRoutes.filter((route) => routeMatchesFilters(route, filters));
  const stopRows = filteredRoutes.flatMap((route) => route.stops.map((stop) => buildStopRow(stop, route, customersByKey)));
  const sellerRows = summarizeSellers(filteredRoutes, stopRows);

  return {
    generatedAt: new Date(),
    routes: filteredRoutes,
    stops: stopRows,
    sellers: sellerRows,
    summary: summarizeReport(filteredRoutes, stopRows),
    options: {
      sellers: uniqueBy(allRoutes.map((route) => ({
        id: route.sellerUid || 'unassigned',
        label: route.sellerName || route.sellerEmail || 'Sem vendedor',
      })), (seller) => seller.id).sort((first, second) => first.label.localeCompare(second.label, 'pt-BR')),
      states: uniqueStrings(allRoutes.map((route) => route.state)),
    },
  };
}

export function routeStatusLabel(status) {
  return {
    planned: 'Planejada',
    assigned: 'Atribuida',
    in_progress: 'Em andamento',
    completed: 'Concluida',
    not_completed: 'Nao realizada',
  }[normalizeRouteStatus(status)] || 'Pendente';
}

export function stopStatusLabel(status) {
  return {
    visited: 'Visitado',
    not_visited: 'Nao visitado',
    in_progress: 'Em visita',
  }[normalizeStopStatus(status)] || 'Pendente';
}

export function routeTypeLabel(type) {
  return type === 'shared' ? 'Atribuida pelo administrador' : 'Criada pelo vendedor';
}

export function feedbackCoverageLabel(percent) {
  if (!Number.isFinite(percent)) return '-';
  return `${Math.round(percent)}%`;
}

function buildRouteRow({ route, routeStops, usersById, customersByKey, telemetry }) {
  const sellerUid = String(route.sellerUid || route.vendedor || route.uid || 'unassigned');
  const seller = usersById.get(sellerUid);
  const stops = asArray(routeStops?.[route.id])
    .sort((first, second) => Number(first.order ?? first.ordem ?? 0) - Number(second.order ?? second.ordem ?? 0));
  const reportedStops = stops.filter((stop) => REPORTED_STOP_STATUSES.has(normalizeStopStatus(stop.status || stop.result)));
  const visitedStops = stops.filter((stop) => normalizeStopStatus(stop.status || stop.result) === 'visited');
  const routeType = route.assignmentType === 'shared' || route.source === 'admin_assignment' ? 'shared' : 'seller';
  const fallbackState = stops
    .map((stop) => customerForStop(stop, customersByKey)?.state || stop.state)
    .find(Boolean);
  const state = clean(route.state || route.sellerState || seller?.state || fallbackState).toUpperCase();
  const status = normalizeRouteStatus(route.status, route.isCompleted);
  const totalStops = stops.length;
  const attendanceDurations = stops.flatMap((stop) => {
    const attendances = completedAttendancesForStop(stop);
    if (attendances.length) return attendances.map(attendanceDurationSeconds).filter(Number.isFinite);
    const legacyDuration = stopVisitDurationSeconds(stop);
    return Number.isFinite(legacyDuration) ? [legacyDuration] : [];
  });
  const totalVisitDurationSeconds = attendanceDurations.reduce((total, duration) => total + duration, 0);
  const visitDurationCount = attendanceDurations.length;

  return {
    id: String(route.id),
    name: route.name || route.nome || `Rota ${route.id}`,
    route,
    routeDate: firstDate(
      route.telemetryStartedAt,
      route.startedAt,
      route.createdAtTimestamp,
      route.createdAt,
    ),
    createdAt: firstDate(route.createdAtTimestamp, route.createdAt),
    completedAt: firstDate(route.completedAt, route.telemetryFinishedAt),
    sellerUid,
    sellerName: seller?.name || route.sellerName || route.createdByName || seller?.email || (sellerUid === 'unassigned' ? 'Sem vendedor' : sellerUid),
    sellerEmail: seller?.email || route.sellerEmail || '',
    state,
    status,
    type: routeType,
    totalStops,
    reportedStops: reportedStops.length,
    visitedStops: visitedStops.length,
    notVisitedStops: reportedStops.length - visitedStops.length,
    feedbackCoveragePercent: percentage(reportedStops.length, totalStops),
    visitRatePercent: percentage(visitedStops.length, totalStops),
    plannedDistanceMeters: finiteOrNull(telemetry?.plannedDistanceMeters ?? route.distanceMeters),
    actualDistanceMeters: finiteOrNull(telemetry?.actualDistanceMeters),
    plannedDurationSeconds: finiteOrNull(telemetry?.plannedDurationSeconds ?? route.durationSeconds),
    actualDurationSeconds: finiteOrNull(telemetry?.actualDurationSeconds),
    movingDurationSeconds: finiteOrNull(telemetry?.movingDurationSeconds),
    stoppedDurationSeconds: finiteOrNull(telemetry?.stoppedDurationSeconds),
    totalVisitDurationSeconds: visitDurationCount ? totalVisitDurationSeconds : null,
    averageVisitDurationSeconds: visitDurationCount ? totalVisitDurationSeconds / visitDurationCount : null,
    completionTargetPercent: finiteOrNull(route.targetCompletionPercent),
    notCompletedReason: clean(route.notCompletedReason),
    routeNotes: clean(route.assignmentNotes || route.notes),
    dueDate: firstDate(route.dueDate),
    hasTelemetry: Boolean(telemetry?.hasTelemetry),
    stops,
  };
}

function buildStopRow(stop, route, customersByKey) {
  const attendances = attendancesForStop(stop);
  const latestAttendance = attendances[0] || null;
  const source = latestAttendance ? { ...stop, ...latestAttendance } : stop;
  const customer = customerForStop(stop, customersByKey);
  const distance = feedbackDistanceFromCustomer(source, customersByKey);
  const status = normalizeStopStatus(source.status || source.result);
  const visitDurationSeconds = stopVisitDurationSeconds(stop);

  return {
    routeId: route.id,
    routeName: route.name,
    routeDate: route.routeDate,
    sellerUid: route.sellerUid,
    sellerName: route.sellerName,
    sellerEmail: route.sellerEmail,
    state: clean(stop.state || customer?.state || route.state).toUpperCase(),
    routeStatus: route.status,
    routeType: route.type,
    order: Number(stop.order ?? stop.ordem ?? 0) || null,
    customerName: stop.customerName || stop.clienteNome || stop.name || customer?.name || customer?.clientName || '-',
    customerExternalId: stop.customerExternalId || stop.customerId || customer?.externalId || customer?.id || '',
    customerCnpjCpf: stop.cnpjCpf || stop.cpfCnpj || customer?.cnpjCpf || customer?.cpfCnpj || '',
    city: stop.city || customer?.city || '',
    segment: stop.segment || customer?.segment || '',
    status,
    attendanceCount: attendances.length,
    feedbackAt: firstDate(
      source.updatedAt,
      source.feedbackAt,
      source.visitedAt,
      source.visitAt,
      source.arrivalTime,
      source.horario,
      source.timestamp,
    ),
    arrivedAt: firstDate(source.arrivedAt, source.arrivedAtClient, source.checkInAt),
    departedAt: firstDate(source.departedAt, source.departedAtClient, source.checkOutAt),
    visitDurationSeconds: finiteOrNull(visitDurationSeconds),
    feedbackDistanceMeters: finiteOrNull(source.checkOutDistanceToCustomerMeters ?? source.checkInDistanceToCustomerMeters ?? distance.meters),
    feedbackLocationAccuracyMeters: finiteOrNull(
      source.checkOutAccuracyMeters ?? source.checkInAccuracyMeters ?? source.feedbackAccuracyMeters ?? source.feedbackLocation?.accuracyMeters,
    ),
    feedback: feedbackText(source),
    notVisitedReason: clean(source.notVisitedReason),
    commercialOutcome: clean(source.commercialOutcome),
    nextAction: clean(source.nextAction),
    nextActionDueDate: clean(source.nextActionDueDate),
  };
}

function summarizeReport(routes, stops) {
  const completedRoutes = routes.filter((route) => route.status === 'completed').length;
  const notCompletedRoutes = routes.filter((route) => route.status === 'not_completed').length;
  const inProgressRoutes = routes.filter((route) => route.status === 'in_progress').length;
  const totalStops = stops.length;
  const reportedStops = stops.filter((stop) => REPORTED_STOP_STATUSES.has(stop.status)).length;
  const visitedStops = stops.filter((stop) => stop.status === 'visited').length;
  const visitDurations = stops.map((stop) => stop.visitDurationSeconds).filter(Number.isFinite);

  return {
    routes: routes.length,
    completedRoutes,
    notCompletedRoutes,
    inProgressRoutes,
    totalStops,
    reportedStops,
    visitedStops,
    notVisitedStops: reportedStops - visitedStops,
    feedbackCoveragePercent: percentage(reportedStops, totalStops),
    visitRatePercent: percentage(visitedStops, totalStops),
    sellers: new Set(routes.map((route) => route.sellerUid).filter(Boolean)).size,
    plannedDistanceMeters: sumFinite(routes.map((route) => route.plannedDistanceMeters)),
    actualDistanceMeters: sumFinite(routes.map((route) => route.actualDistanceMeters)),
    actualDurationSeconds: sumFinite(routes.map((route) => route.actualDurationSeconds)),
    movingDurationSeconds: sumFinite(routes.map((route) => route.movingDurationSeconds)),
    stoppedDurationSeconds: sumFinite(routes.map((route) => route.stoppedDurationSeconds)),
    totalVisitDurationSeconds: visitDurations.length ? sumFinite(visitDurations) : null,
    averageVisitDurationSeconds: visitDurations.length ? sumFinite(visitDurations) / visitDurations.length : null,
  };
}

function summarizeSellers(routes, stops) {
  const stopsBySeller = stops.reduce((groups, stop) => {
    const current = groups.get(stop.sellerUid) || [];
    current.push(stop);
    groups.set(stop.sellerUid, current);
    return groups;
  }, new Map());

  return [...routes.reduce((groups, route) => {
    const current = groups.get(route.sellerUid) || [];
    current.push(route);
    groups.set(route.sellerUid, current);
    return groups;
  }, new Map()).entries()]
    .map(([sellerUid, sellerRoutes]) => {
      const sellerStops = stopsBySeller.get(sellerUid) || [];
      const reportedStops = sellerStops.filter((stop) => REPORTED_STOP_STATUSES.has(stop.status));
      const visitedStops = sellerStops.filter((stop) => stop.status === 'visited');
      const visitDurations = sellerStops.map((stop) => stop.visitDurationSeconds).filter(Number.isFinite);

      return {
        sellerUid,
        sellerName: sellerRoutes[0]?.sellerName || 'Sem vendedor',
        sellerEmail: sellerRoutes[0]?.sellerEmail || '',
        states: uniqueStrings(sellerRoutes.map((route) => route.state)).join(', '),
        routes: sellerRoutes.length,
        completedRoutes: sellerRoutes.filter((route) => route.status === 'completed').length,
        notCompletedRoutes: sellerRoutes.filter((route) => route.status === 'not_completed').length,
        totalStops: sellerStops.length,
        reportedStops: reportedStops.length,
        visitedStops: visitedStops.length,
        feedbackCoveragePercent: percentage(reportedStops.length, sellerStops.length),
        visitRatePercent: percentage(visitedStops.length, sellerStops.length),
        plannedDistanceMeters: sumFinite(sellerRoutes.map((route) => route.plannedDistanceMeters)),
        actualDistanceMeters: sumFinite(sellerRoutes.map((route) => route.actualDistanceMeters)),
        actualDurationSeconds: sumFinite(sellerRoutes.map((route) => route.actualDurationSeconds)),
        averageVisitDurationSeconds: visitDurations.length ? sumFinite(visitDurations) / visitDurations.length : null,
      };
    })
    .sort((first, second) => second.reportedStops - first.reportedStops || second.routes - first.routes);
}

function routeMatchesFilters(route, filters) {
  const search = clean(filters?.search).toLocaleLowerCase('pt-BR');
  const routeSearchText = [
    route.name,
    route.id,
    route.sellerName,
    route.sellerEmail,
    ...route.stops.map((stop) => stop.customerName || stop.clienteNome || stop.name),
  ].join(' ').toLocaleLowerCase('pt-BR');

  return (
    (!filters?.sellerId || route.sellerUid === filters.sellerId)
    && (!filters?.state || route.state === filters.state)
    && (!filters?.status || route.status === filters.status)
    && (!filters?.routeType || filters.routeType === 'all' || route.type === filters.routeType)
    && (!search || routeSearchText.includes(search))
    && isWithinDateRange(route.routeDate, filters?.dateFrom, filters?.dateTo)
  );
}

function normalizeRouteStatus(status, isCompleted = false) {
  if (isCompleted === true) return 'completed';
  const normalized = clean(status).toLocaleLowerCase('pt-BR');
  if (['completed', 'concluida', 'concluída'].includes(normalized)) return 'completed';
  if (['not_completed', 'nao realizada', 'não realizada'].includes(normalized)) return 'not_completed';
  if (['in_progress', 'em andamento'].includes(normalized)) return 'in_progress';
  if (normalized === 'assigned') return 'assigned';
  return normalized === 'planned' ? 'planned' : 'planned';
}

function normalizeStopStatus(status) {
  const normalized = clean(status).toLocaleLowerCase('pt-BR');
  if (normalized === 'visited') return 'visited';
  if (normalized === 'not_visited') return 'not_visited';
  if (normalized === 'in_progress') return 'in_progress';
  return 'pending';
}

function feedbackText(stop) {
  const feedback = clean(stop.feedback || stop.visitFeedback || stop.feedbackText || stop.observation || stop.notes);
  return feedback || '';
}

function isWithinDateRange(date, dateFrom, dateTo) {
  if (!date && (dateFrom || dateTo)) return false;
  const timestamp = routeTimestamp(date);
  const from = dateFrom ? localDateStart(dateFrom) : null;
  const to = dateTo ? localDateEnd(dateTo) : null;
  return (!from || timestamp >= from) && (!to || timestamp <= to);
}

function localDateStart(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function localDateEnd(value) {
  return localDateStart(value) + 86_399_999;
}

function firstDate(...values) {
  for (const value of values) {
    const date = normalizeDate(value);
    if (date) return date;
  }
  return null;
}

function routeTimestamp(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumFinite(values) {
  const validValues = values.filter(Number.isFinite);
  return validValues.length ? validValues.reduce((total, value) => total + value, 0) : null;
}

function percentage(value, total) {
  if (!total) return null;
  return (value / total) * 100;
}

function uniqueStrings(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((first, second) => first.localeCompare(second, 'pt-BR'));
}

function uniqueBy(values, getKey) {
  const keys = new Set();
  return values.filter((value) => {
    const key = getKey(value);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function clean(value) {
  return String(value ?? '').trim();
}
