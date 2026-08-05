import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, type User } from './lib/api';
import { Shell } from './components/Shell';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { Requisitions } from './pages/Requisitions';
import { NewRequisition } from './pages/NewRequisition';
import { RequisitionDetail } from './pages/RequisitionDetail';

function Protected({ user, children }: { user: User | null | undefined; children: React.ReactNode }) {
  const location = useLocation();
  if (user === undefined) return null; // still resolving session
  if (user === null) return <Navigate to="/signin" state={{ from: location }} replace />;
  return <>{children}</>;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    api.get<{ user: User }>('/v1/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  }, []);

  const refreshQueue = useCallback(() => {
    api.get<{ queueCount: number }>('/v1/dashboard')
      .then((d) => setQueueCount(d.queueCount))
      .catch(() => undefined);
  }, []);
  useEffect(() => { if (user) refreshQueue(); }, [user, refreshQueue]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/signin" element={<SignIn onSignedIn={(u) => setUser(u)} />} />
        <Route
          element={
            <Protected user={user}>
              <Shell user={user!} queueCount={queueCount} onSignOut={() => setUser(null)} />
            </Protected>
          }
        >
          <Route path="/dashboard" element={user ? <Dashboard user={user} /> : null} />
          <Route path="/requisitions" element={<Requisitions />} />
          <Route path="/requisitions/new" element={<NewRequisition />} />
          <Route path="/requisitions/:id" element={<RequisitionDetail />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
