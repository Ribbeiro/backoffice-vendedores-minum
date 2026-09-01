import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import {
  Box,
  Button,
  Divider,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import OperationalDetailsDrawer, { OperationalDrawerSection } from './OperationalDetailsDrawer';
import StatusIndicator from './StatusIndicator';
import { currencyBRL, formatDateTime } from '../utils/formatters';
import { coordinatesFromCustomer, formatDistanceMeters } from '../utils/locationDistance';
import { statusLabel } from '../utils/customerVisits';
import { attendanceDurationSeconds } from '../utils/routeAttendances';
import { customerPrimaryName } from '../utils/customerDisplay';

const FIELD_GROUPS = [
  {
    title: 'Identificacao',
    fields: [
      { label: 'ID do cadastro', keys: ['id'] },
      { label: 'Codigo Minum', keys: ['minumCode', 'externalId'] },
      { label: 'ID tecnico Odoo', keys: ['odooLeadId'] },
      { label: 'ID externo Odoo', keys: ['odooExternalId'] },
      { label: 'Empresa / oportunidade', keys: ['opportunity', 'name'] },
      { label: 'Contato principal', keys: ['clientName', 'contactName'] },
      { label: 'CNPJ / CPF', keys: ['cnpjCpf', 'cpfCnpj'] },
    ],
  },
  {
    title: 'Contato e endereco',
    fields: [
      { label: 'Endereco', keys: ['address', 'dealAddress'] },
      { label: 'Cidade', keys: ['city'] },
      { label: 'Estado', keys: ['state'] },
      { label: 'Pais', keys: ['country'] },
      { label: 'Telefone', keys: ['phone'], type: 'phone' },
      { label: 'E-mail', keys: ['email'], type: 'email' },
      { label: 'Coordenadas cadastradas', keys: ['coordinates'], type: 'coordinates' },
    ],
  },
  {
    title: 'Oportunidade comercial',
    fields: [
      { label: 'Segmento', keys: ['segment'] },
      { label: 'Etapa comercial', keys: ['pipelineStage', 'status'] },
      { label: 'Receita esperada', keys: ['expectedRevenueValue', 'expectedRevenue'], type: 'currency' },
      { label: 'Responsavel', keys: ['responsible', 'responsavel'] },
      { label: 'Vendedor responsavel', keys: ['responsibleSalesperson', 'responsableSalesperson'] },
      { label: 'Distribuidor', keys: ['distributor'] },
      { label: 'Origem', keys: ['origin', 'origem'] },
      { label: 'Tags', keys: ['tags'] },
      { label: 'Ultima atualizacao', keys: ['lastUpdate', 'ultimaAtualizacao'] },
      { label: 'Observacoes', keys: ['notes'] },
    ],
  },
];

const KNOWN_FIELDS = new Set(FIELD_GROUPS.flatMap(({ fields }) => fields.flatMap(({ keys }) => keys)));

export default function CustomerDetailsDrawer({
  customer,
  open,
  onClose,
  visits = [],
  routesById,
  usersById,
  onDelete,
  isDeleting = false,
}) {
  if (!customer) return null;

  const details = FIELD_GROUPS.map((group) => ({
    ...group,
    fields: group.fields
      .map((field) => ({ ...field, value: valueForField(customer, field) }))
      .filter((field) => hasValue(field.value)),
  })).filter((group) => group.fields.length > 0);
  const extraFields = Object.entries(customer)
    .filter(([key, value]) => !KNOWN_FIELDS.has(key) && hasValue(value) && key !== 'visits')
    .sort(([first], [second]) => first.localeCompare(second, 'pt-BR'));
  const title = customerPrimaryName(customer);

  return (
    <OperationalDetailsDrawer
      open={open}
      onClose={onClose}
      eyebrow="Cliente"
      title={title}
      subtitle={`${customer.city || 'Cidade nao informada'}${customer.state ? ` - ${customer.state}` : ''}`}
      status={(
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <StatusIndicator status={customer.pipelineStage || customer.status} label={customer.pipelineStage || customer.status || 'Sem etapa'} />
          {customer.active === false && <StatusIndicator status="not_visited" label="Inativo" />}
        </Stack>
      )}
      actions={customer.phone ? (
        <Button component="a" href={`tel:${String(customer.phone).replace(/\s/g, '')}`} variant="outlined" startIcon={<PhoneOutlinedIcon />}>
          Ligar para o cliente
        </Button>
      ) : null}
      aria-label={`Detalhes de ${title}`}
    >
      <Stack spacing={2.5}>
        {details.map((group) => (
          <OperationalDrawerSection key={group.title} title={group.title}>
            <Stack spacing={1.25}>
              {group.fields.map((field) => (
                <DetailRow key={field.label} label={field.label} value={field.value} type={field.type} />
              ))}
            </Stack>
          </OperationalDrawerSection>
        ))}

        {extraFields.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <OperationalDrawerSection title="Dados adicionais importados">
            <Stack spacing={1.25}>
              {extraFields.map(([key, value]) => <DetailRow key={key} label={humanizeKey(key)} value={value} />)}
            </Stack>
            </OperationalDrawerSection>
          </>
        )}

        <>
          <Divider sx={{ mb: 2 }} />
          <OperationalDrawerSection title="Feedbacks de visita">
          {visits.length === 0 && (
            <Typography variant="body2" color="text.secondary">Nenhum feedback foi registrado para este cliente.</Typography>
          )}
          <Stack spacing={1.5}>
            {visits.map((visit, index) => (
              <VisitFeedback
                key={`${visit.routeId}-${visit.id || index}-${visit.timestamp || index}`}
                visit={visit}
                route={routesById?.get(String(visit.routeId))}
                user={usersById?.get(String((routesById?.get(String(visit.routeId))?.sellerUid) || ''))}
              />
            ))}
          </Stack>
          </OperationalDrawerSection>
        </>

        {onDelete && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Button
              color="error"
              variant="text"
              startIcon={<DeleteOutlineIcon />}
              disabled={isDeleting}
              onClick={onDelete}
            >
              Excluir cliente da base
            </Button>
          </>
        )}
      </Stack>
    </OperationalDetailsDrawer>
  );
}

function DetailRow({ label, value, type }) {
  const renderedValue = renderValue(value, type);
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: type === 'notes' ? 'pre-wrap' : 'normal' }}>
        {renderedValue}
      </Typography>
    </Box>
  );
}

function VisitFeedback({ visit, route, user }) {
  const seller = user?.name || user?.displayName || user?.email || route?.sellerName || route?.vendedorNome || 'Vendedor nao identificado';
  const feedback = visit.feedback || visit.visitFeedback || visit.feedbackText || visit.observation || visit.notes || 'Sem observacao registrada.';
  const reason = visit.notVisitedReason;
  const outcome = visit.commercialOutcome;
  const nextAction = visit.nextAction;
  const checkIn = visit.checkInAt;
  const checkOut = visit.checkOutAt;
  const duration = attendanceDurationSeconds(visit);
  const checkInDistance = Number(visit.checkInDistanceToCustomerMeters);
  const checkOutDistance = Number(visit.checkOutDistanceToCustomerMeters);

  return (
    <Box sx={{ borderLeft: '3px solid', borderColor: visit.status === 'visited' ? 'success.main' : 'error.main', pl: 1.25 }}>
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
        <StatusIndicator status={visit.status} label={statusLabel(visit.status)} />
        <Typography variant="caption" color="text.secondary">{formatDateTime(visit.timestamp)}</Typography>
      </Stack>
      <Typography variant="body2" mt={0.75}>{feedback}</Typography>
      {(checkIn || checkOut) && (
        <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>
          Check-in: {formatDateTime(checkIn)} | Checkout: {formatDateTime(checkOut)} | Permanencia: {duration === null ? '-' : `${Math.round(duration / 60)} min`}
        </Typography>
      )}
      {(Number.isFinite(checkInDistance) || Number.isFinite(checkOutDistance)) && (
        <Typography variant="caption" color="text.secondary" display="block" mt={0.35}>
          Distancia no check-in: {Number.isFinite(checkInDistance) ? formatDistanceMeters(checkInDistance) : '-'} | Checkout: {Number.isFinite(checkOutDistance) ? formatDistanceMeters(checkOutDistance) : '-'}
        </Typography>
      )}
      {reason && <Typography variant="body2" color="text.secondary" mt={0.5}>Motivo: {reason}</Typography>}
      {outcome && <Typography variant="body2" color="text.secondary" mt={0.5}>Resultado: {outcome}</Typography>}
      {nextAction && (
        <Typography variant="body2" color="primary.main" mt={0.5}>
          Proximo passo: {nextAction}{visit.nextActionDueDate ? ` ate ${visit.nextActionDueDate}` : ''}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>{seller}</Typography>
    </Box>
  );
}

function valueForField(customer, field) {
  if (field.type === 'coordinates') {
    const coordinates = coordinatesFromCustomer(customer);
    return coordinates ? `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}` : null;
  }

  return field.keys.map((key) => customer[key]).find(hasValue) ?? null;
}

function renderValue(value, type) {
  if (type === 'currency') return currencyBRL(value);
  if (type === 'phone') return <Link href={`tel:${String(value).replace(/\s/g, '')}`}>{String(value)}</Link>;
  if (type === 'email') return <Link href={`mailto:${String(value)}`}>{String(value)}</Link>;
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Nao';
  return String(value);
}

function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function humanizeKey(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
