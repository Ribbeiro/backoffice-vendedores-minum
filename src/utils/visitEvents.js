import { asArray } from './helpers';
import { normalizeDate } from './formatters';

export function flattenVisitEvents(eventsMap) {
  return Object.entries(eventsMap || {})
    .flatMap(([routeId, stops]) => Object.entries(stops || {}).flatMap(([stopId, events]) => (
      asArray(events).map((event) => ({
        ...event,
        routeId: event.routeId || routeId,
        stopId: event.stopId || stopId,
      }))
    )))
    .sort((first, second) => eventTimestamp(second) - eventTimestamp(first));
}

export function feedbackEvents(events) {
  return events.filter((event) => event.eventType === 'feedback_submitted');
}

export function eventTimestamp(event) {
  const date = normalizeDate(event?.createdAt || event?.feedbackAt || event?.timestamp);
  return date?.getTime() || 0;
}

export function eventsForCustomer(customer, events) {
  const keys = customerKeys(customer);
  return events.filter((event) => eventKeys(event).some((key) => keys.includes(key)));
}

export function visitStatusLabel(status) {
  if (status === 'visited') return 'Visitado';
  if (status === 'not_visited') return 'Nao visitado';
  if (status === 'in_progress') return 'Em visita';
  return 'Pendente';
}

export function formatGpsDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return 'Sem distancia';
  if (value < 1_000) return `${Math.round(value)} m`;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
}

export function distanceConfidence(meters, accuracyMeters) {
  const distance = Number(meters);
  const accuracy = Number(accuracyMeters);
  if (!Number.isFinite(distance)) return { label: 'Sem GPS', color: 'default' };
  if (Number.isFinite(accuracy) && accuracy > 100) return { label: 'GPS impreciso', color: 'warning' };
  if (distance <= 150) return { label: 'Proximo', color: 'success' };
  if (distance <= 1_500) return { label: 'Distante', color: 'warning' };
  return { label: 'Muito distante', color: 'error' };
}

function customerKeys(customer) {
  return uniqueKeys([customer?.id, customer?.externalId, customer?.cnpjCpf, customer?.cpfCnpj]);
}

function eventKeys(event) {
  return uniqueKeys([event?.customerId, event?.customerExternalId, event?.customerCnpjCpf]);
}

function uniqueKeys(values) {
  return [...new Set(values.flatMap(keyVariants).filter(Boolean))];
}

function keyVariants(value) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return [];
  const compact = normalized.replace(/[^\p{L}\p{N}]/gu, '');
  return compact && compact !== normalized ? [normalized, compact] : [normalized];
}
