import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoadIcon from '@mui/icons-material/AddRoad';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import InsightsIcon from '@mui/icons-material/Insights';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import MinumLine from './MinumLine';
import MinumLogo from './MinumLogo';
import { minumTokens } from '../design/tokens';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

const drawerWidth = 272;

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Clientes', to: '/clientes', icon: <PeopleAltIcon /> },
  { label: 'Upload', to: '/upload', icon: <UploadFileIcon /> },
  { label: 'Criar rota', to: '/criar-rota', icon: <AddRoadIcon /> },
  { label: 'Historico', to: '/historico', icon: <HistoryIcon /> },
  { label: 'Inteligencia', to: '/inteligencia', icon: <InsightsIcon /> },
  { label: 'Vendedores', to: '/vendedores', icon: <GroupIcon /> },
  { label: 'Criar usuarios', to: '/usuarios', icon: <PersonAddAlt1Icon /> },
];

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width:900px)');
  const { logout, profile } = useAuth();
  const { error } = useData();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const navItemSx = {
    borderRadius: 1,
    mb: 0.5,
    minHeight: 44,
    color: alpha(minumTokens.text.inverse, 0.76),
    '&:hover': {
      bgcolor: alpha(minumTokens.brand.energy, 0.12),
      color: minumTokens.text.inverse,
    },
    '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 38 },
    '&.active': {
      bgcolor: minumTokens.brand.energy,
      color: minumTokens.brand.primaryDark,
      '& .MuiListItemIcon-root': { color: minumTokens.brand.primaryDark },
    },
  };

  const drawer = (
    <Box className="minum-sidebar" height="100%" display="flex" flexDirection="column">
      <Box px={3} pt={3} pb={2.5}>
        <MinumLogo mode="light" size="md" sx={{ width: 132 }} />
        <Typography variant="overline" sx={{ color: minumTokens.brand.light, display: 'block', mt: 2 }}>
          BACKOFFICE OPERACIONAL
        </Typography>
        <Typography variant="body2" sx={{ color: alpha(minumTokens.text.inverse, 0.72), mt: 0.25 }}>
          Visao clara para decidir melhor.
        </Typography>
        <MinumLine tone="inverse" sx={{ mt: 2 }} />
      </Box>
      <Divider sx={{ borderColor: alpha(minumTokens.text.inverse, 0.14) }} />
      <List sx={{ px: 1.25, py: 1.5, flex: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            sx={navItemSx}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }} />
          </ListItemButton>
        ))}
      </List>
      <Box p={2.5} borderTop="1px solid" borderColor={alpha(minumTokens.text.inverse, 0.14)}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(minumTokens.brand.light, 0.24), color: minumTokens.brand.light }}>
            {(profile?.name || profile?.email || 'A').charAt(0).toUpperCase()}
          </Avatar>
          <Box minWidth={0} flex={1}>
            <Typography variant="caption" sx={{ color: alpha(minumTokens.text.inverse, 0.56), display: 'block' }}>Sessao ativa</Typography>
            <Typography variant="body2" fontWeight={600} noWrap>{profile?.name || profile?.email || 'Administrador'}</Typography>
          </Box>
        </Stack>
        <Button
          startIcon={<LogoutIcon />}
          fullWidth
          sx={{ mt: 1.5, justifyContent: 'flex-start', color: minumTokens.text.inverse, '&:hover': { bgcolor: alpha(minumTokens.text.inverse, 0.1) } }}
          onClick={handleLogout}
        >
          Sair
        </Button>
      </Box>
    </Box>
  );

  return (
    <Box display="flex" minHeight="100vh" bgcolor="background.default">
      <AppBar
        position="fixed"
        color="transparent"
        elevation={0}
        sx={{
          bgcolor: alpha(minumTokens.surface.elevated, 0.96),
          borderBottom: '1px solid',
          borderColor: 'divider',
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
        }}
      >
        <Toolbar sx={{ minHeight: '64px !important' }}>
          {!isDesktop && (
            <Tooltip title="Abrir menu">
              <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }} aria-label="Abrir menu">
                <MenuIcon />
              </IconButton>
            </Tooltip>
          )}
          <Box>
            <Typography variant="subtitle1" color="text.primary">Painel administrativo</Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box width={6} height={6} borderRadius="50%" bgcolor="secondary.main" />
              <Typography variant="caption" color="text.secondary">Dados atualizados em tempo real</Typography>
            </Stack>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, borderRight: 0 } }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" flex={1} sx={{ p: { xs: 2, md: 3.5 }, mt: 8, width: { md: `calc(100% - ${drawerWidth}px)` } }}>
        <Box maxWidth={1600} mx="auto">
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
