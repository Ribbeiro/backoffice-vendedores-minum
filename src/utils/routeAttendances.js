import { asArray } from './helpers';
import { normalizeDate } from './formatters';

const COMPLETED_STATUSES = new Set(['visited', 'not_visited']);

/**
 * Normaliza a colecao 1:N enviada pelo app. Rotas antigas nao possuem esse
 * filho; nesses casos o historico continua usando os campos legados da parada.
 */
export function attendancesForStop(stop) {
  return asArray(stop?.attendances)
    .map((attendance) => ({
      ...attendance,
      status: normalizeAttendanceStatus(attendance.status || attendance.result),
      timestamp: attendanceTimestamp(attendance),
    }))
    .sort((first, second) => second.timestamp - first.timestamp);
}

export function completedAttendancesForStop(stop) {
  return attendancesForStop(stop).filter((attendance) => COMPLETED_STATUSES.has(attendance.status));
}

export function latestAttendanceForStop(stop) {
  return attendancesForStop(stop)[0] || null;
}

export function attendanceDurationSeconds(attendance) {
  const savedDuration = numberOrNull(attendance?.visitDurationSeconds);
  if (savedDuration !== null) return savedDuration;

  const checkIn = timestampValue(attendance?.checkInAt);
  const checkOut = timestampValue(attendance?.checkOutAt);
  if (checkIn === null || checkOut === null || checkOut < checkIn) return null;
  return Math.round((checkOut - checkIn) / 1_000);
}

export function attendanceTimestamp(attendance) {
  return timestampValue(
    attendance?.updatedAt
    || attendance?.feedbackAt
    || attendance?.checkOutAt
    || attendance?.checkInAt,
  ) || 0;
}

export function normalizeAttendanceStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'visited') return 'visited';
  if (normalized === 'not_visited') return 'not_visited';
  if (normalized === 'awaiting_feedback') return 'awaiting_feedback';
  return normalized === 'in_progress' ? 'in_progress' : 'pending';
}

function timestampValue(value) {
  const date = normalizeDate(value);
  return date ? date.getTime() : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
