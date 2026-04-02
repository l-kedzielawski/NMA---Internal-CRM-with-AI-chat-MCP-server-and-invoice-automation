import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { CostsPage } from './pages/CostsPage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoiceCreatePage } from './pages/InvoiceCreatePage';
import { ProductsPage } from './pages/ProductsPage';
import { CrmPage } from './pages/CrmPage';
import { CalendarPage } from './pages/CalendarPage';
import { PriorityQueuePage } from './pages/PriorityQueuePage';
import { CrmConflictsPage } from './pages/CrmConflictsPage';
import { LoginPage } from './pages/LoginPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { LogsPage } from './pages/LogsPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { useAuth } from './contexts/AuthContext';
import { ACCESS_ROLES, getDefaultRouteForRole, hasRoleAccess } from './utils/accessControl';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function RoleProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: readonly ('admin' | 'manager' | 'bookkeeping' | 'seller')[];
}) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasRoleAccess(user.role, allowedRoles)) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
  }

  return <>{children}</>;
}

function App() {
  const { isAuthenticated, user } = useAuth();

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={isAuthenticated ? <Navigate to={getDefaultRouteForRole(user?.role)} replace /> : <LoginPage />} 
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.dashboard}><DashboardPage /></RoleProtectedRoute>} />
                  <Route path="/invoices" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.invoices}><InvoicesPage /></RoleProtectedRoute>} />
                  <Route path="/costs" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.costs}><CostsPage /></RoleProtectedRoute>} />
                  <Route path="/invoices/new" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.invoices}><InvoiceCreatePage /></RoleProtectedRoute>} />
                  <Route path="/invoices/:id" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.invoices}><InvoiceDetailPage /></RoleProtectedRoute>} />
                  <Route path="/products" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.products}><ProductsPage /></RoleProtectedRoute>} />
                  <Route path="/upload" element={<Navigate to="/invoices" replace />} />
                  <Route path="/opiekunowie" element={<Navigate to="/users" replace />} />
                  <Route path="/crm" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.crm}><CrmPage /></RoleProtectedRoute>} />
                  <Route path="/calendar" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.calendar}><CalendarPage /></RoleProtectedRoute>} />
                  <Route path="/crm/priority" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.crm}><PriorityQueuePage /></RoleProtectedRoute>} />
                  <Route path="/crm/conflicts" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.crm}><CrmConflictsPage /></RoleProtectedRoute>} />
                  <Route path="/users" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.users}><UserManagementPage /></RoleProtectedRoute>} />
                  <Route path="/logs" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.logs}><LogsPage /></RoleProtectedRoute>} />
                  <Route path="/resources" element={<RoleProtectedRoute allowedRoles={ACCESS_ROLES.resources}><ResourcesPage /></RoleProtectedRoute>} />
                  <Route path="*" element={<Navigate to={getDefaultRouteForRole(user?.role)} replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
