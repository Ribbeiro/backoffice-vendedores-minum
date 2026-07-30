import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PageHeader from '../components/PageHeader';
import { createManagedUser } from '../services/api';
import { useData } from '../hooks/useData';

const SELLER_STATES = ['MS', 'MT', 'PA', 'MA', 'GO'];
const INITIAL_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'vendedor',
  state: 'MS',
};

export default function Usuarios() {
  const { users } = useData();
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sortedUsers = useMemo(
    () => [...users].sort((first, second) => String(first.name || first.email).localeCompare(String(second.name || second.email))),
    [users],
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (form.password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const user = await createManagedUser(form);
      setSuccess(`Conta de ${user.name} criada com acesso ativo.`);
      setForm(INITIAL_FORM);
    } catch (creationError) {
      setError(toUserMessage(creationError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader title="Criar usuarios" subtitle="Cadastre contas administradoras e vendedores." />

      <Grid container spacing={3} alignItems="flex-start">
        <Grid item xs={12} lg={7}>
          <Paper component="form" onSubmit={handleSubmit} sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2.5}>
              <Typography variant="h6">Dados da conta</Typography>
              {error && <Alert severity="error">{error}</Alert>}
              {success && <Alert severity="success">{success}</Alert>}

              <TextField
                label="Nome completo"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                autoComplete="name"
                required
                fullWidth
              />
              <TextField
                label="Email de acesso"
                type="email"
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                autoComplete="email"
                required
                fullWidth
              />
              <TextField
                label="Senha"
                type="password"
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                autoComplete="new-password"
                helperText="Minimo de 6 caracteres. A senha nao e armazenada no banco de dados."
                required
                fullWidth
              />

              <FormControl fullWidth>
                <InputLabel id="user-role-label">Tipo de usuario</InputLabel>
                <Select
                  labelId="user-role-label"
                  label="Tipo de usuario"
                  value={form.role}
                  onChange={(event) => updateField('role', event.target.value)}
                >
                  <MenuItem value="vendedor">Vendedor</MenuItem>
                  <MenuItem value="admin">Administrador</MenuItem>
                </Select>
              </FormControl>

              {form.role === 'vendedor' && (
                <FormControl fullWidth>
                  <InputLabel id="seller-state-label">Estado do vendedor</InputLabel>
                  <Select
                    labelId="seller-state-label"
                    label="Estado do vendedor"
                    value={form.state}
                    onChange={(event) => updateField('state', event.target.value)}
                  >
                    {SELLER_STATES.map((state) => (
                      <MenuItem key={state} value={state}>
                        {state}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <Box display="flex" justifyContent="flex-end">
                <Button
                  type="submit"
                  variant="contained"
                  startIcon={submitting ? <CircularProgress color="inherit" size={18} /> : <PersonAddAlt1Icon />}
                  disabled={submitting}
                >
                  Criar conta
                </Button>
              </Box>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper sx={{ overflow: 'hidden' }}>
            <Box px={2.5} py={2} borderBottom="1px solid" borderColor="divider">
              <Typography variant="h6">Contas cadastradas</Typography>
            </Box>
            <TableContainer sx={{ maxHeight: 590 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Usuario</TableCell>
                    <TableCell>Perfil</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedUsers.map((user) => (
                    <TableRow key={user.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {user.name || user.displayName || user.email || user.id}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {user.email || user.id}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5} alignItems="flex-start">
                          <Chip
                            label={String(user.role || 'vendedor').toLowerCase() === 'admin' ? 'Administrador' : 'Vendedor'}
                            size="small"
                            color={String(user.role || '').toLowerCase() === 'admin' ? 'secondary' : 'primary'}
                          />
                          {user.state && <Typography variant="caption">{user.state}</Typography>}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip label={user.active === true ? 'Ativo' : 'Inativo'} size="small" color={user.active === true ? 'success' : 'default'} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {sortedUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="center">
                        Nenhuma conta cadastrada.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}

function toUserMessage(error) {
  const code = String(error?.code || '');
  if (code === 'auth/email-already-in-use') return 'Ja existe uma conta com este email.';
  if (code === 'auth/invalid-email') return 'Digite um email valido.';
  if (code === 'auth/weak-password') return 'A senha precisa ter pelo menos 6 caracteres.';
  if (code === 'auth/operation-not-allowed') return 'O login por email e senha nao esta habilitado no Firebase Authentication.';
  if (code === 'PERMISSION_DENIED') return 'Sua conta nao tem permissao para cadastrar usuarios.';
  return error?.message || 'Nao foi possivel criar a conta. Tente novamente.';
}
