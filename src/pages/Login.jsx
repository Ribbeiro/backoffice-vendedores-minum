import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import MinumLine from '../components/MinumLine';
import MinumLogo from '../components/MinumLogo';
import { minumTokens } from '../design/tokens';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const { login, loading, error, isAdmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  if (isAdmin) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setLocalError('');
    try {
      await login(email, password);
    } catch {
      setLocalError('Nao foi possivel entrar. Revise seu email e senha e tente novamente.');
    }
  }

  return (
    <Box className="brand-texture" minHeight="100vh" display="grid" sx={{ placeItems: 'center', p: { xs: 2, sm: 4 } }}>
      <Box width="100%" maxWidth={1080} display="grid" sx={{ gridTemplateColumns: { xs: '1fr', md: '1fr 0.9fr' }, minHeight: { md: 620 } }}>
        <Stack display={{ xs: 'none', md: 'flex' }} justifyContent="space-between" p={6} color={minumTokens.text.inverse}>
          <Box>
            <MinumLogo mode="light" size="lg" />
            <MinumLine tone="inverse" sx={{ mt: 3 }} />
          </Box>
          <Box maxWidth={430}>
            <Typography variant="h3">Energia para quem busca economia.</Typography>
            <Typography variant="body1" sx={{ mt: 2, color: minumTokens.brand.light }}>
              Uma operacao comercial mais clara, proxima e eficiente para cada decisao.
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: minumTokens.brand.light }}>Backoffice Minum</Typography>
        </Stack>

        <Paper elevation={0} sx={{ alignSelf: 'center', p: { xs: 3, sm: 5 }, borderRadius: { xs: 1, md: '8px 0 0 8px' }, boxShadow: minumTokens.shadow.medium }}>
          <Stack spacing={3}>
            <Stack spacing={1.25}>
              <MinumLogo size="lg" sx={{ display: { xs: 'block', md: 'none' } }} />
              <Typography variant="overline" color="secondary.main">ACESSO SEGURO</Typography>
              <Typography variant="h4">Entre no backoffice.</Typography>
              <Typography color="text.secondary">Use uma conta administradora para gerenciar clientes, rotas e vendedores.</Typography>
              <MinumLine sx={{ mt: 0.75 }} />
            </Stack>
            {(localError || error) && <Alert severity="error">{localError || error}</Alert>}
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField label="Email de acesso" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required fullWidth />
                <TextField label="Senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required fullWidth />
                <Button variant="contained" color="secondary" size="large" type="submit" disabled={loading} startIcon={<LockIcon />}>
                  {loading ? 'Validando acesso...' : 'Entrar no backoffice'}
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
