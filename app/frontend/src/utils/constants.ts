/**
 * Pagination constants
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const TOP_PRODUCTS_LIMIT = 8;

/**
 * Payment status constants
 */
export const PaymentStatus = {
  PAID: 'oplacona',
  UNPAID: 'nieoplacona',
  PARTIAL: 'czesciowa',
  REFUND: 'zwrot'
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

/**
 * User role constants
 */
export const UserRole = {
  ADMIN: 'admin',
  BOOKKEEPING: 'bookkeeping',
  SELLER: 'seller'
} as const;

export type UserRole = typeof UserRole[keyof typeof UserRole];

/**
 * CRM Pipeline types
 */
export const PipelineType = {
  COLD_LEAD: 'cold_lead',
  CONTACT: 'contact'
} as const;

export type PipelineType = typeof PipelineType[keyof typeof PipelineType];

/**
 * Icon sizes
 */
export const ICON_SIZES = {
  small: 16,
  regular: 18,
  large: 20
} as const;
