import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import PrivateRoute from './components/PrivateRoute.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clientes from './pages/Clientes.jsx';
import CriarRota from './pages/CriarRota.jsx';
import Historico from './pages/Historico.jsx';
import Login from './pages/Login.jsx';
import Upload from './pages/Upload.jsx';
import Usuarios from './pages/Usuarios.jsx';
import Vendedores from './pages/Vendedores.jsx';
import Revalidacao from './pages/Revalidacao.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="revalidacao" element={<Revalidacao />} />
          <Route path="criar-rota" element={<CriarRota />} />
          <Route path="upload" element={<Upload />} />
          <Route path="historico" element={<Historico />} />
          <Route path="inteligencia" element={<Navigate to="/dashboard" replace />} />
          <Route path="vendedores" element={<Vendedores />} />
          <Route path="usuarios" element={<Usuarios />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
