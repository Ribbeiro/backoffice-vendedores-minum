import { eventTimestamp } from './visitEvents';

export const FOLLOW_UP_STATUS = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
});

/**
 * Converte os proximos passos informados pelos vendedores em uma fila de
 * trabalho auditavel. Cada feedback continua sendo uma tarefa independente,
 * inclusive quando o cliente recebeu mais de uma visita no mesmo dia.
 */
export function buildFollowUpTasks(events) {
  return events
    .filter((event) => event.eventType === 'feedback_submitted' && String(event.nextAction || '').trim())
    .map((event) => ({
      ...event,
      followUpStatus: normalizeFollowUpStatus(event.followUpStatus),
      dueAt: dueDateTimestamp(event.nextActionDueDate),
      createdAtTimestamp: eventTimestamp(event),
    }))
    .sort((first, second) => {
      const firstPriority = followUpPriority(first);
      const secondPriority = followUpPriority(second);
      if (firstPriority !== secondPriority) return firstPriority - secondPriority;
      return (first.dueAt || Number.MAX_SAFE_INTEGER) - (second.dueAt || Number.MAX_SAFE_INTEGER)
        || second.createdAtTimestamp - first.createdAtTimestamp;
    });
}

export function normalizeFollowUpStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === FOLLOW_UP_STATUS.IN_PROGRESS) return FOLLOW_UP_STATUS.IN_PROGRESS;
  if (normalized === FOLLOW_UP_STATUS.COMPLETED) return FOLLOW_UP_STATUS.COMPLETED;
  return FOLLOW_UP_STATUS.OPEN;
}

export function followUpStatusLabel(status) {
  if (status === FOLLOW_UP_STATUS.IN_PROGRESS) return 'Em acompanhamento';
  if (status === FOLLOW_UP_STATUS.COMPLETED) return 'Concluida';
  return 'Em aberto';
}

export function followUpStatusColor(status) {
  if (status === FOLLOW_UP_STATUS.IN_PROGRESS) return 'info';
  if (status === FOLLOW_UP_STATUS.COMPLETED) return 'success';
  return 'warning';
}

export function isFollowUpOverdue(task, now = Date.now()) {
  return task.followUpStatus !== FOLLOW_UP_STATUS.COMPLETED
    && Number.isFinite(task.dueAt)
    && task.dueAt < now;
}

export function nextFollowUpStatus(status) {
  if (status === FOLLOW_UP_STATUS.OPEN) return FOLLOW_UP_STATUS.IN_PROGRESS;
  if (status === FOLLOW_UP_STATUS.IN_PROGRESS) return FOLLOW_UP_STATUS.COMPLETED;
  return FOLLOW_UP_STATUS.OPEN;
}

export function nextFollowUpActionLabel(status) {
  if (status === FOLLOW_UP_STATUS.OPEN) return 'Assumir';
  if (status === FOLLOW_UP_STATUS.IN_PROGRESS) return 'Concluir';
  return 'Reabrir';
}

function followUpPriority(task) {
  if (isFollowUpOverdue(task)) return 0;
  if (task.followUpStatus === FOLLOW_UP_STATUS.IN_PROGRESS) return 1;
  if (task.followUpStatus === FOLLOW_UP_STATUS.OPEN) return 2;
  return 3;
}

function dueDateTimestamp(value) {
  const date = String(value || '').trim();
  if (!date) return null;
  const parsed = new Date(`${date}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
