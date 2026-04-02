import { useEffect, useState, type ComponentType } from 'react';
import { LayoutDashboard, FileText, Package, LogOut, Building2, Menu, X, UserCircle, Settings, CalendarDays, ListOrdered, GitMerge, History, BookText, Key, ReceiptText } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ChangePasswordModal } from '../ChangePasswordModal';
import { AiChatBubble } from '../AiChat/AiChatBubble';
import toast from 'react-hot-toast';
import { ACCESS_ROLES, hasRoleAccess } from '../../utils/accessControl';

interface LayoutProps {
  children: React.ReactNode;
}

type MenuItem = {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  allowedRoles: readonly ('admin' | 'manager' | 'bookkeeping' | 'seller')[];
};

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const menuItems: MenuItem[] = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard, allowedRoles: ACCESS_ROLES.dashboard },
    { path: '/invoices', label: 'Invoices', icon: FileText, allowedRoles: ACCESS_ROLES.invoices },
    { path: '/costs', label: 'Costs', icon: ReceiptText, allowedRoles: ACCESS_ROLES.costs },
    { path: '/products', label: 'Products', icon: Package, allowedRoles: ACCESS_ROLES.products },
    { path: '/crm/priority', label: 'Priority Queue', icon: ListOrdered, allowedRoles: ACCESS_ROLES.crm },
    { path: '/crm/conflicts', label: 'CRM Conflicts', icon: GitMerge, allowedRoles: ACCESS_ROLES.crm },
    { path: '/crm', label: 'CRM', icon: Building2, allowedRoles: ACCESS_ROLES.crm },
    { path: '/calendar', label: 'Calendar', icon: CalendarDays, allowedRoles: ACCESS_ROLES.calendar },
    { path: '/resources', label: 'Sales Resources', icon: BookText, allowedRoles: ACCESS_ROLES.resources },
    { path: '/users', label: 'Team Management', icon: Settings, allowedRoles: ACCESS_ROLES.users },
    { path: '/logs', label: 'App Logs', icon: History, allowedRoles: ACCESS_ROLES.logs },
  ];

  const allMenuItems = menuItems.filter((item) => hasRoleAccess(user?.role, item.allowedRoles));

  return (
    <div className="app-shell flex min-h-screen bg-background">
      {mobileNavOpen ? (
        <button
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close menu"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`no-print sidebar-shell fixed inset-y-0 left-0 z-40 w-72 flex flex-col transform transition-transform duration-300 md:static md:w-64 md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-6 border-b border-border">
          <img
            src="/brand/logo-dark-theme.png"
            alt="Operations CRM"
            className="h-16 w-auto max-w-full object-contain brand-glow rounded-lg"
          />
        </div>

        <div className="px-4 pt-4">
          <div className="brand-banner rounded-xl p-3">
              <p className="relative z-10 text-sm font-semibold text-[#ffe9c7]">Internal sales, finance, and CRM workspace</p>
          </div>
        </div>
        
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {allMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || 
                (item.path !== '/' && location.pathname.startsWith(item.path));
              
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`nav-link flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                      isActive 
                        ? 'nav-link-active' 
                        : ''
                    }`}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-border space-y-3">
          {/* User info */}
          <div className="px-4 py-2 bg-surface-1 rounded-xl">
            <div className="flex items-center gap-3">
              <UserCircle size={24} className="text-primary" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{user?.full_name}</p>
                <p className="text-xs text-text-muted truncate">{user?.email}</p>
                <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded">
                  {user?.role}
                </span>
              </div>
            </div>
          </div>
          
          {/* Change Password button */}
          <button 
            onClick={() => setShowChangePassword(true)}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-text-muted hover:bg-surface-1 hover:text-primary transition-colors w-full"
          >
            <Key size={20} />
            <span>Change Password</span>
          </button>
          
          {/* Logout button */}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-text-muted hover:bg-surface-1 hover:text-danger transition-colors w-full"
          >
            <LogOut size={20} />
            <span>Wyloguj</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="print-main flex-1 overflow-auto min-w-0">
        <header className="no-print header-shell px-4 py-3 md:px-8 md:py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileNavOpen((current) => !current)}
                className="btn-secondary p-2 md:hidden"
                aria-label="Toggle menu"
              >
                {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
                <h2 className="text-lg font-semibold text-text">
                {allMenuItems.find(item => 
                  location.pathname === item.path || 
                  (item.path !== '/' && location.pathname.startsWith(item.path))
                )?.label || 'Panel'}
              </h2>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden sm:inline text-sm text-text-muted">Logged in as:</span>
              <div className="flex items-center gap-2">
                <UserCircle size={20} className="text-primary" />
                <span className="font-medium text-sm">{user?.full_name}</span>
              </div>
            </div>
          </div>
        </header>
        
        <div className="content-shell p-4 md:p-8">
          {children}
        </div>
      </main>

      <ChangePasswordModal 
        isOpen={showChangePassword} 
        onClose={() => setShowChangePassword(false)} 
      />

      {hasRoleAccess(user?.role, ACCESS_ROLES.crm) ? <AiChatBubble /> : null}
    </div>
  );
}
