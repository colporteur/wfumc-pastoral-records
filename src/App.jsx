import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PersonList from './pages/PersonList.jsx';
import PersonNew from './pages/PersonNew.jsx';
import PersonDetail from './pages/PersonDetail.jsx';
import ImportPage from './pages/ImportPage.jsx';
import NotFound from './pages/NotFound.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/people" element={<PersonList />} />
        <Route path="/people/new" element={<PersonNew />} />
        <Route path="/people/:id" element={<PersonDetail />} />
        <Route path="/import" element={<ImportPage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
