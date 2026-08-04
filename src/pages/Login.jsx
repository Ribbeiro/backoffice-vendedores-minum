import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from '../hooks/useAuth';
import minumLogo from '../assets/minum-logo.png';

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
      setLocalError('Email ou senha invalidos.');
    }
  }

  return (
    <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center', bgcolor: 'primary.main', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 }, '&:last-child': { pb: { xs: 3, sm: 4 } } }}>
          <Stack spacing={2.5}>
            <Stack alignItems="center" spacing={1.25}>
              <Box component="img" src={minumLogo} alt="Minum" sx={{ width: 170, maxWidth: '80%' }} />
              <Box className="minum-brand-line" />
              <Typography variant="h5">Backoffice Minum</Typography>
              <Typography color="text.secondary" textAlign="center">
                Entre com uma conta administradora.
              </Typography>
            </Stack>
            {(localError || error) && <Alert severity="error">{localError || error}</Alert>}
            <Box component="form" onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required fullWidth />
                <TextField label="Senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required fullWidth />
                <Button variant="contained" color="secondary" size="large" type="submit" disabled={loading} startIcon={<LockIcon />}>
                  Entrar
                </Button>
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
