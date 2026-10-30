import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { SitesPage } from './pages/SitesPage';
import { SitePage } from './pages/SitePage';
import { InspectionsPage } from './pages/InspectionsPage';
import { InspectionEditorPage } from './pages/InspectionEditorPage';
import { ConflictPage } from './pages/ConflictPage';

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted" aria-busy="true">
        Loading…
      </div>
    );
  }
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<SitesPage />} />
              <Route path="sites/:siteId" element={<SitePage />} />
              <Route path="inspections" element={<InspectionsPage />} />
              <Route path="inspections/:id" element={<InspectionEditorPage />} />
              <Route path="inspections/:id/conflict" element={<ConflictPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
