import CloseIcon from '@mui/icons-material/Close';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';
import {
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import StatusIndicator from './StatusIndicator';
import { currencyBRL, formatDateTime } from '../utils/formatters';
import { coordinatesFromCustomer } from '../utils/locationDistance';
import { statusLabel } from '../utils/customerVisits';

const FIELD_GROUPS = [
  {
    title: 'Identificacao',
    fields: [
      { label: 'ID do cadastro', keys: ['id'] },
      { label: 'ID externo', keys: ['externalId'] },
      { label: 'Empresa', keys: ['clientName', 'opportunity'] },
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

export default function CustomerDetailsDrawer({ customer, open, onClose, visits = [], routesById, usersById }) {
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
  const title = customer.name || customer.clientName || customer.opportunity || customer.id;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 540 }, bgcolor: 'background.default' } }}
      aria-label={`Detalhes de ${title}`}
    >
      <Stack spacing={2.5} sx={{ p: { xs: 2, sm: 3 }, minHeight: '100%' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
          <Box>
            <Typography variant="overline" color="primary.main">Cliente</Typography>
            <Typography variant="h5" component="h2" sx={{ mt: 0.25, pr: 1, overflowWrap: 'anywhere' }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              {customer.city || 'Cidade nao informada'}{customer.state ? ` - ${customer.state}` : ''}
            </Typography>
          </Box>
          <IconButton aria-label="Fechar detalhes do cliente" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <StatusIndicator status={customer.pipelineStage || customer.status} label={customer.pipelineStage || customer.status || 'Sem etapa'} />
          {customer.active === false && <StatusIndicator status="not_visited" label="Inativo" />}
        </Stack>

        {customer.phone && (
          <Button component="a" href={`tel:${String(customer.phone).replace(/\s/g, '')}`} variant="outlined" startIcon={<PhoneOutlinedIcon />}>
            Ligar para o cliente
          </Button>
        )}

        {details.map((group) => (
          <Box key={group.title}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" mb={1.25}>{group.title}</Typography>
            <Stack spacing={1.25}>
              {group.fields.map((field) => (
                <DetailRow key={field.label} label={field.label} value={field.value} type={field.type} />
              ))}
            </Stack>
          </Box>
        ))}

        {extraFields.length > 0 && (
          <Box>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" mb={1.25}>Dados adicionais importados</Typography>
            <Stack spacing={1.25}>
              {extraFields.map(([key, value]) => <DetailRow key={key} label={humanizeKey(key)} value={value} />)}
            </Stack>
          </Box>
        )}

        <Box>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle2" mb={1.25}>Feedbacks de visita</Typography>
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
        </Box>
      </Stack>
    </Drawer>
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

  return (
    <Box sx={{ borderLeft: '3px solid', borderColor: visit.status === 'visited' ? 'success.main' : 'error.main', pl: 1.25 }}>
      <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
        <StatusIndicator status={visit.status} label={statusLabel(visit.status)} />
        <Typography variant="caption" color="text.secondary">{formatDateTime(visit.timestamp)}</Typography>
      </Stack>
      <Typography variant="body2" mt={0.75}>{feedback}</Typography>
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
