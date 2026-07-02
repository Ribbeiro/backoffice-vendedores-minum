import { Navigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../hooks/useAuth';

export default function PrivateRoute({ children }) {
  const { loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}>
        <Box textAlign="center">
          <CircularProgress />
          <Typography mt={2}>Validando acesso...</Typography>
        </Box>
      </Box>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
