import { normalizeDate } from './formatters';
import { asArray } from './helpers';
import { flattenVisitEvents } from './visitEvents';
import { attendanceDurationSeconds, completedAttendancesForStop } from './routeAttendances';

const REPORTED_STOP_STATUSES = new Set(['visited', 'not_visited']);

/**
 * Converte o historico de eventos e os agregados da rota em metricas de negocio.
 * O aplicativo grava pontos apenas durante uma navegacao ativa; portanto, valores
 * sem telemetria continuam como "-" em vez de parecerem uma medicao real.
 */
export function buildRouteTelemetry(routes, routeStopsMap, visitEventsMap) {
  const eventsByRoute = groupEventsByRoute(flattenVisitEvents(visitEventsMap));

  return routes
    .map((route) => {
      const routeId = String(route.id || '');
      const events = eventsByRoute.get(routeId) || [];
      const stops = asArray(routeStopsMap?.[route.id])
        .sort((first, second) => Number(first.order ?? first.ordem ?? 0) - Number(second.order ?? second.ordem ?? 0));
      const startEvent = firstEvent(events, 'route_started');
      const finishEvent = lastEvent(events, 'route_finished');
      const hasTelemetry = Boolean(
        route.telemetryVersion
        || route.telemetryStartedAt
        || route.telemetryStatus
        || startEvent,
      );
      const plannedDistanceMeters = firstFinite(route.plannedDistanceMeters, route.distanceMeters);
      const plannedDurationSeconds = firstFinite(route.plannedDurationSeconds, route.durationSeconds);
      const startedAt = firstTimestamp(
        route.telemetryStartedAt,
        route.telemetryStartedAtClient,
        startEvent?.createdAt,
      );
      const finishedAt = firstTimestamp(
        route.telemetryFinishedAt,
        route.telemetryFinishedAtClient,
        finishEvent?.createdAt,
      );
      const actualDistanceMeters = firstFinite(
        route.actualDistanceMeters,
        latestFiniteEventValue(events, 'actualDistanceMeters'),
      );
      const actualDurationSeconds = firstFinite(
        route.actualDurationSeconds,
        latestFiniteEventValue(events, 'actualDurationSeconds'),
        elapsedSeconds(startedAt, finishedAt),
      );
      const movingDurationSeconds = firstFinite(
        route.movingDurationSeconds,
        latestFiniteEventValue(events, 'movingDurationSeconds'),
      );
      const stoppedDurationSeconds = firstFinite(
        route.stoppedDurationSeconds,
        latestFiniteEventValue(events, 'stoppedDurationSeconds'),
      );
      const locationSampleCount = firstFinite(
        route.locationSampleCount,
        latestFiniteEventValue(events, 'locationSampleCount'),
      );
      const reportedStops = stops.filter((stop) => REPORTED_STOP_STATUSES.has(normalizeStopStatus(stop)));
      const visitedStops = reportedStops.filter((stop) => normalizeStopStatus(stop) === 'visited');
      // Uma parada pode conter mais de uma tentativa. Para as rotas novas, a
      // media considera todos os atendimentos concluidos, nao so o ultimo.
      const attendanceDurations = stops.flatMap((stop) => {
        const attendances = completedAttendancesForStop(stop);
        if (attendances.length) {
          return attendances.map(attendanceDurationSeconds).filter(Number.isFinite);
        }
        const legacyDuration = stopVisitDurationSeconds(stop);
        return Number.isFinite(legacyDuration) ? [legacyDuration] : [];
      });
      const totalVisitDurationSeconds = attendanceDurations.reduce((total, duration) => total + duration, 0);

      return {
        route,
        routeId,
        sellerUid: route.sellerUid || route.vendedor || route.uid || '',
        sellerName: route.sellerName || route.vendedorNome || route.sellerEmail || route.sellerUid || 'Sem vendedor',
        stops,
        events,
        hasTelemetry,
        startedAt,
        finishedAt,
        plannedDistanceMeters,
        plannedDurationSeconds,
        actualDistanceMeters,
        actualDurationSeconds,
        movingDurationSeconds,
        stoppedDurationSeconds,
        locationSampleCount,
        completionPercent: firstFinite(
          route.completionPercent,
          stops.length ? Math.round((reportedStops.length / stops.length) * 100) : null,
        ),
        reportedStops: reportedStops.length,
        visitedStops: visitedStops.length,
        averageVisitDurationSeconds: attendanceDurations.length
          ? totalVisitDurationSeconds / attendanceDurations.length
          : null,
        totalVisitDurationSeconds: attendanceDurations.length ? totalVisitDurationSeconds : null,
        visitDurationCount: attendanceDurations.length,
        distanceVariancePercent: percentageVariance(actualDistanceMeters, plannedDistanceMeters),
        durationVariancePercent: percentageVariance(actualDurationSeconds, plannedDurationSeconds),
        lastTelemetryAt: firstTimestamp(route.lastLocationAt, lastEvent(events, 'route_progress')?.createdAt, finishEvent?.createdAt),
      };
    })
    .sort((first, second) => routeTimestamp(second.route) - routeTimestamp(first.route));
}

/** Agrupa o desempenho para comparacao justa entre vendedores e periodos. */
export function summarizeSellerTelemetry(routeMetrics) {
  const groups = new Map();

  routeMetrics.filter((item) => item.hasTelemetry).forEach((item) => {
    const key = item.sellerUid || item.sellerName;
    const current = groups.get(key) || {
      sellerUid: item.sellerUid,
      sellerName: item.sellerName,
      routes: 0,
      plannedDistanceMeters: 0,
      actualDistanceMeters: 0,
      plannedDurationSeconds: 0,
      actualDurationSeconds: 0,
      movingDurationSeconds: 0,
      stoppedDurationSeconds: 0,
      reportedStops: 0,
      visitedStops: 0,
      totalVisitDurationSeconds: 0,
      visitDurationCount: 0,
    };

    current.routes += 1;
    addMetric(current, 'plannedDistanceMeters', item.plannedDistanceMeters);
    addMetric(current, 'actualDistanceMeters', item.actualDistanceMeters);
    addMetric(current, 'plannedDurationSeconds', item.plannedDurationSeconds);
    addMetric(current, 'actualDurationSeconds', item.actualDurationSeconds);
    addMetric(current, 'movingDurationSeconds', item.movingDurationSeconds);
    addMetric(current, 'stoppedDurationSeconds', item.stoppedDurationSeconds);
    current.reportedStops += item.reportedStops;
    current.visitedStops += item.visitedStops;
    if (Number.isFinite(item.totalVisitDurationSeconds)) {
      current.totalVisitDurationSeconds += item.totalVisitDurationSeconds;
      current.visitDurationCount += item.visitDurationCount;
    }
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((item) => ({
      ...item,
      visitRate: item.reportedStops ? Math.round((item.visitedStops / item.reportedStops) * 100) : null,
      averageVisitDurationSeconds: item.visitDurationCount
        ? item.totalVisitDurationSeconds / item.visitDurationCount
        : null,
      visitsPerRoute: item.routes ? item.reportedStops / item.routes : null,
      visitsPerHour: item.actualDurationSeconds
        ? (item.reportedStops * 3_600) / item.actualDurationSeconds
        : null,
      distanceVariancePercent: percentageVariance(item.actualDistanceMeters, item.plannedDistanceMeters),
      durationVariancePercent: percentageVariance(item.actualDurationSeconds, item.plannedDurationSeconds),
    }))
    .sort((first, second) => second.reportedStops - first.reportedStops || second.routes - first.routes);
}

export function stopVisitDurationSeconds(stop) {
  const latestAttendance = completedAttendancesForStop(stop)[0];
  if (latestAttendance) return attendanceDurationSeconds(latestAttendance);
  const savedDuration = numberOrNull(stop.visitDurationSeconds);
  if (savedDuration !== null) return savedDuration;
  return elapsedSeconds(
    firstTimestamp(stop.checkInAt, stop.arrivedAt, stop.arrivedAtClient),
    firstTimestamp(stop.checkOutAt, stop.departedAt, stop.departedAtClient),
  );
}

export function formatTelemetryDistance(meters) {
  const value = numberOrNull(meters);
  if (value === null) return '-';
  if (value < 1_000) return `${Math.round(value)} m`;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
}

export function formatTelemetryDuration(seconds) {
  const value = numberOrNull(seconds);
  if (value === null) return '-';
  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${rounded} s`;
}

export function formatTelemetryVariance(percent) {
  const value = numberOrNull(percent);
  if (value === null) return 'Sem comparativo';
  if (Math.abs(value) < 5) return 'Dentro do previsto';
  const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.abs(value));
  return `${formatted}% ${value > 0 ? 'acima' : 'abaixo'} do previsto`;
}

export function telemetryVarianceColor(percent) {
  const value = numberOrNull(percent);
  if (value === null) return 'info';
  if (value <= 5) return 'success';
  if (value <= 20) return 'warning';
  return 'error';
}

function groupEventsByRoute(events) {
  return events.reduce((groups, event) => {
    const routeId = String(event.routeId || '');
    if (!routeId) return groups;
    const current = groups.get(routeId) || [];
    current.push(event);
    groups.set(routeId, current);
    return groups;
  }, new Map());
}

function firstEvent(events, type) {
  return events
    .filter((event) => event.eventType === type)
    .sort((first, second) => eventTime(first) - eventTime(second))[0] || null;
}

function lastEvent(events, type) {
  return events
    .filter((event) => event.eventType === type)
    .sort((first, second) => eventTime(second) - eventTime(first))[0] || null;
}

function latestFiniteEventValue(events, field) {
  const event = [...events]
    .sort((first, second) => eventTime(second) - eventTime(first))
    .find((item) => numberOrNull(item[field]) !== null);
  return event ? numberOrNull(event[field]) : null;
}

function normalizeStopStatus(stop) {
  return String(stop.status || stop.result || '').trim().toLowerCase();
}

function addMetric(target, key, value) {
  const number = numberOrNull(value);
  if (number !== null) target[key] += number;
}

function percentageVariance(actual, planned) {
  const actualNumber = numberOrNull(actual);
  const plannedNumber = numberOrNull(planned);
  if (actualNumber === null || plannedNumber === null || plannedNumber <= 0) return null;
  return ((actualNumber - plannedNumber) / plannedNumber) * 100;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstTimestamp(...values) {
  for (const value of values) {
    const date = normalizeDate(value);
    if (date) return date.getTime();
  }
  return null;
}

function elapsedSeconds(startedAt, finishedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return null;
  return Math.round((finishedAt - startedAt) / 1_000);
}

function eventTime(event) {
  return normalizeDate(event?.createdAt || event?.timestamp)?.getTime() || 0;
}

function routeTimestamp(route) {
  return firstTimestamp(route.telemetryStartedAt, route.createdAtTimestamp, route.createdAt) || 0;
}
