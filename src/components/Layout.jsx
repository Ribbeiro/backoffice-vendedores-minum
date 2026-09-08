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
  ListSubheader,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoadIcon from '@mui/icons-material/AddRoad';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
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
import { useThemeMode } from '../context/ThemeModeContext';

const drawerWidth = 272;

const navigationGroups = [
  {
    label: 'Visao geral',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: <DashboardIcon /> }],
  },
  {
    label: 'Operacao',
    items: [
      { label: 'Clientes', to: '/clientes', icon: <PeopleAltIcon /> },
      { label: 'Inteligência operacional', to: '/inteligencia', icon: <InsightsOutlinedIcon /> },
      { label: 'Revalidação', to: '/revalidacao', icon: <HistoryIcon /> },
      { label: 'Importar base', to: '/upload', icon: <UploadFileIcon /> },
      { label: 'Criar rota', to: '/criar-rota', icon: <AddRoadIcon /> },
    ],
  },
  {
    label: 'Gestao de acesso',
    items: [
      { label: 'Criar usuarios', to: '/usuarios', icon: <PersonAddAlt1Icon /> },
      { label: 'Vendedores', to: '/vendedores', icon: <GroupIcon /> },
    ],
  },
  {
    label: 'Auditoria',
    items: [{ label: 'Historico de rotas', to: '/historico', icon: <HistoryIcon /> }],
  },
];

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery('(min-width:900px)');
  const { logout, profile } = useAuth();
  const { error, needsOperations, routeLimit, canLoadOlderRoutes, loadOlderRoutes, operationsLoading } = useData();
  const { mode, toggleColorMode } = useThemeMode();
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
    <Box className="minum-sidebar" display="flex" flexDirection="column" sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
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
      <List className="minum-sidebar-nav" sx={{ px: 1.25, py: 1.5, flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {navigationGroups.map((group) => (
          <Box key={group.label} sx={{ mb: 1.25 }}>
            <ListSubheader
              disableSticky
              sx={{
                bgcolor: 'transparent',
                color: alpha(minumTokens.text.inverse, 0.48),
                fontSize: 10,
                fontWeight: 700,
                lineHeight: '28px',
                letterSpacing: 0,
                textTransform: 'uppercase',
              }}
            >
              {group.label}
            </ListSubheader>
            {group.items.map((item) => (
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
          </Box>
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
          bgcolor: alpha(theme.palette.background.paper, 0.94),
          backdropFilter: 'blur(12px)',
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
            <Typography variant="subtitle1" color="text.primary">Operacao Minum</Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Box width={6} height={6} borderRadius="50%" bgcolor="secondary.main" />
              <Typography variant="caption" color="text.secondary">Dados atualizados em tempo real</Typography>
            </Stack>
          </Box>
          <Box flex={1} />
          <Tooltip title={mode === 'dark' ? 'Usar modo claro' : 'Usar modo escuro'}>
            <IconButton
              onClick={toggleColorMode}
              color="inherit"
              aria-label={mode === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            >
              {mode === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              height: '100dvh',
              bgcolor: minumTokens.brand.primaryDark,
              color: minumTokens.text.inverse,
              overflow: 'hidden',
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              height: '100dvh',
              borderRight: 0,
              bgcolor: minumTokens.brand.primaryDark,
              color: minumTokens.text.inverse,
              overflow: 'hidden',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" flex={1} sx={{ p: { xs: 2, md: 3.5 }, mt: 8, width: { md: `calc(100% - ${drawerWidth}px)` }, transition: 'background-color 200ms ease' }}>
        <Box maxWidth={1600} mx="auto">
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {needsOperations && (
            <Alert severity="info" sx={{ mb: 2 }} action={canLoadOlderRoutes && (
              <Button color="inherit" size="small" onClick={loadOlderRoutes} disabled={operationsLoading}>Carregar mais 50</Button>
            )}>
              {operationsLoading ? 'Atualizando rotas e atendimentos...' : `Indicadores e historico: ultimas ${routeLimit} rotas e rotas abertas. Carregue mais para consultar visitas e retornos antigos.`}
            </Alert>
          )}
          <Box sx={{ display: needsOperations && operationsLoading ? 'none' : 'contents' }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
