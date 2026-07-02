import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
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
      setLocalError('Email ou senha invalidos.');
    }
  }

  return (
    <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center', background: 'linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%)', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2.5}>
            <Stack alignItems="center" spacing={1}>
              <Box display="grid" sx={{ placeItems: 'center', width: 56, height: 56, borderRadius: 2, bgcolor: 'primary.main', color: 'white' }}>
                <LockIcon />
              </Box>
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
                <Button variant="contained" size="large" type="submit" disabled={loading}>
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
