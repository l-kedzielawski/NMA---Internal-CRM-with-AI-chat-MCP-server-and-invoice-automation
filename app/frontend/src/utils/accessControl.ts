export type AppRole = 'admin' | 'manager' | 'bookkeeping' | 'seller';

export const ACCESS_ROLES = {
  dashboard: ['admin', 'manager', 'bookkeeping'] as const,
  invoices: ['admin', 'manager', 'bookkeeping'] as const,
  costs: ['admin', 'manager', 'bookkeeping'] as const,
  products: ['admin', 'manager', 'bookkeeping', 'seller'] as const,
  crm: ['admin', 'manager', 'seller'] as const,
  calendar: ['admin', 'manager', 'seller'] as const,
  resources: ['admin', 'manager', 'seller'] as const,
  users: ['admin', 'manager'] as const,
  logs: ['admin'] as const,
};

const DEFAULT_ROUTE_BY_ROLE: Record<AppRole, string> = {
  admin: '/',
  manager: '/',
  bookkeeping: '/',
  seller: '/crm',
};

export function hasRoleAccess(role: AppRole | null | undefined, allowedRoles: readonly AppRole[]): boolean {
  if (!role) return false;
  return allowedRoles.includes(role);
}

export function getDefaultRouteForRole(role: AppRole | null | undefined): string {
  if (!role) return '/';
  return DEFAULT_ROUTE_BY_ROLE[role] ?? '/';
}
