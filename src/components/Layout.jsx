import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddRoadIcon from '@mui/icons-material/AddRoad';
import { Alert } from '@mui/material';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useData } from '../hooks/useData';

const drawerWidth = 248;

const navItems = [
  { label: 'Dashboard', to: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Clientes', to: '/clientes', icon: <PeopleAltIcon /> },
  { label: 'Upload', to: '/upload', icon: <UploadFileIcon /> },
  { label: 'Criar rota', to: '/criar-rota', icon: <AddRoadIcon /> },
  { label: 'Historico', to: '/historico', icon: <HistoryIcon /> },
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

  const drawer = (
    <Box height="100%" display="flex" flexDirection="column">
      <Toolbar>
        <Box>
          <Typography variant="h6">Minum</Typography>
          <Typography variant="body2" color="text.secondary">
            Backoffice
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1, flex: 1 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            onClick={() => setMobileOpen(false)}
            sx={{
              borderRadius: 2,
              mb: 0.5,
              '&.active': {
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
              },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Box p={2}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {profile?.name || profile?.email || 'Administrador'}
        </Typography>
        <Button startIcon={<LogoutIcon />} fullWidth sx={{ mt: 1 }} onClick={handleLogout}>
          Sair
        </Button>
      </Box>
    </Box>
  );

  return (
    <Box display="flex" minHeight="100vh">
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: '1px solid #e2e8f0', width: { md: `calc(100% - ${drawerWidth}px)` }, ml: { md: `${drawerWidth}px` } }}
      >
        <Toolbar>
          {!isDesktop && (
            <Tooltip title="Menu">
              <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
                <MenuIcon />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="h6" color="text.primary">
            Painel administrativo
          </Typography>
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
          sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, borderRight: '1px solid #e2e8f0' } }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" flex={1} sx={{ p: { xs: 2, md: 3 }, mt: 8, width: { md: `calc(100% - ${drawerWidth}px)` } }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Outlet />
      </Box>
    </Box>
  );
}
