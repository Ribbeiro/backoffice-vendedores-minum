import { asArray } from './helpers';
import { attendancesForStop } from './routeAttendances';

const VISITED = 'visited';
const NOT_VISITED = 'not_visited';

/**
 * Agrupa as paradas do Firebase por cliente para exibir no mapa o ultimo
 * resultado e todo o historico de feedbacks de cada ponto.
 */
export function buildCustomerVisitIndex(routeStops) {
  const visitsByCustomer = new Map();

  Object.entries(routeStops || {}).forEach(([routeId, stops]) => {
    asArray(stops).forEach((stop) => {
      const attendances = attendancesForStop(stop);
      const sourceVisits = attendances.length ? attendances : [stop];

      sourceVisits.forEach((attendance) => {
        const visit = {
          ...stop,
          ...attendance,
          routeId,
          status: normalizeVisitStatus(attendance.status || attendance.result || stop.status || stop.result || stop.visitStatus),
          timestamp: visitTimestamp(attendance),
          feedback: attendance.feedback || attendance.visitFeedback || attendance.feedbackText || attendance.observation || attendance.notes || '',
        };

        customerKeysFromStop(stop).forEach((key) => {
          const current = visitsByCustomer.get(key) || [];
          current.push(visit);
          visitsByCustomer.set(key, current);
        });
      });
    });
  });

  visitsByCustomer.forEach((visits, key) => {
    visits.sort((first, second) => second.timestamp - first.timestamp);
    visitsByCustomer.set(key, visits);
  });

  return visitsByCustomer;
}

export function visitsForCustomer(customer, visitsByCustomer) {
  return customerKeys(customer)
    .map((key) => visitsByCustomer.get(key))
    .find((value) => value?.length > 0) || [];
}

export function latestVisitStatus(visits) {
  const latestCompletedVisit = visits.find((visit) => visit.status === VISITED || visit.status === NOT_VISITED);
  return latestCompletedVisit?.status || 'pending';
}

export function hasCustomerCoordinates(customer) {
  const latitude = Number(customer?.latitude);
  const longitude = Number(customer?.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export function statusLabel(status) {
  if (status === VISITED) return 'Visitado';
  if (status === NOT_VISITED) return 'Nao visitado';
  return 'Pendente';
}

function customerKeys(customer) {
  return uniqueKeys([customer?.id, customer?.externalId, customer?.cnpjCpf, customer?.cpfCnpj]);
}

function customerKeysFromStop(stop) {
  return uniqueKeys([stop?.id, stop?.customerExternalId, stop?.customerId]);
}

function uniqueKeys(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function normalizeVisitStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === VISITED) return VISITED;
  if (status === NOT_VISITED) return NOT_VISITED;
  return 'pending';
}

function visitTimestamp(stop) {
  const value = stop.updatedAt || stop.feedbackAt || stop.visitedAt || stop.checkOutAt || stop.checkInAt || stop.visitAt || stop.arrivalTime || stop.timestamp || 0;
  if (typeof value === 'number') return value;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue;

  const parsedValue = Date.parse(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}
