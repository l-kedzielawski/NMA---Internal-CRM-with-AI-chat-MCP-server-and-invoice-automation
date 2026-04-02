# Code Tour

## 1. Start with the backend entry point

**Which files:** `app/backend/src/index.ts`

**What to look for:** This file shows the application shape quickly. You can see the public health and auth routes, the protected route groups, the rate limiters, and where CRM, invoices, costs, resources, logs, and AI are mounted.

## 2. Read the AI guardrail layer

**Which files:** `app/backend/src/routes/ai.ts`

**What to look for:** This is one of the most custom parts of the system. Look at the allowlisted action names, the Zod schemas, the model response contract, and the rule that AI still has to go through explicit backend validation.

## 3. Read the invoice and finance path

**Which files:** `app/backend/src/routes/invoices.ts`, `app/backend/src/services/invoiceRecalculation.ts`

**What to look for:** The invoice route is large because it carries a lot of business behavior. Focus on owner splits, invoice totals, payment fields, grouped invoices, and how recalculation derives margin and commission from stored invoice and product data.

## 4. Read the document parsers

**Which files:** `app/backend/src/services/pdfParser.ts`, `app/backend/src/services/costDocumentParser.ts`

**What to look for:** These files explain why the app is more than CRUD. The invoice parser is tuned for Polish invoice patterns. The cost parser handles PDFs, spreadsheets, CSV, and text, then returns suggested values with confidence and warnings.

## 5. Read the costs module

**Which files:** `app/backend/src/routes/costs.ts`, `app/frontend/src/pages/CostsPage.tsx`

**What to look for:** This is where grouped commercial costs become first-class records. Watch how document preview, invoice-group validation, and linked invoices work together.

## 6. Read the CRM workflow layer

**Which files:** `app/backend/src/routes/crm.ts`

**What to look for:** Start with the types and templates near the top. Then look for lead score, duplicate handling, activities, tasks, recurrence, and ownership-sensitive behavior. This route explains how the operational sales flow actually works.

## 7. Read the schema after the main routes

**Which files:** `app/database/schema.sql`

**What to look for:** The schema is the clearest summary of the product model. Read these groups in order:

1. users and audit logs
2. customers, products, and price tiers
3. invoice groups, invoices, invoice items, cost entries, cost documents
4. CRM leads, activities, imports, tasks, duplicate cases, lead products

## 8. Read the frontend routing and role model

**Which files:** `app/frontend/src/App.tsx`, `app/frontend/src/utils/accessControl.ts`

**What to look for:** This shows which screens exist and who can access them. It is the fastest way to understand how admin, manager, bookkeeping, and seller experiences diverge.

## 9. Read the main shell and navigation

**Which files:** `app/frontend/src/components/Layout/Layout.tsx`

**What to look for:** The sidebar is a practical summary of the product. It also shows where the AI chat is mounted and which roles see it.

## 10. Read the finance-facing frontend screens

**Which files:** `app/frontend/src/pages/DashboardPage.tsx`, `app/frontend/src/pages/InvoicesPage.tsx`, `app/frontend/src/pages/InvoiceDetailPage.tsx`, `app/frontend/src/pages/CostsPage.tsx`

**What to look for:** These pages show how backend finance logic becomes operator workflow: summaries, invoice status, linked costs, and review UI.

## 11. Read the CRM-facing frontend screens

**Which files:** `app/frontend/src/pages/CrmPage.tsx`, `app/frontend/src/pages/CalendarPage.tsx`, `app/frontend/src/pages/PriorityQueuePage.tsx`, `app/frontend/src/pages/CrmConflictsPage.tsx`

**What to look for:** These screens show how lead work is prioritized and scheduled. Pay attention to the queue and conflict views because they are more specific than a generic contact list.

## 12. Read the internal knowledge layer

**Which files:** `app/frontend/src/pages/ResourcesPage.tsx`, `app/backend/src/routes/resources.ts`, `app/frontend/src/components/RichEmailEditor.tsx`

**What to look for:** This is where the app crosses from operations into reusable sales knowledge. The translation and version structure is worth reading.

## 13. Read the audit and admin surfaces

**Which files:** `app/frontend/src/pages/LogsPage.tsx`, `app/backend/src/routes/logs.ts`, `app/frontend/src/pages/UserManagementPage.tsx`

**What to look for:** These screens explain how the app stays operable over time: who did what, who can access what, and how accounts are managed.

## 14. Finish with the integration boundary

**Which files:** `app/mcp/src/index.ts`

**What to look for:** This is the external AI adapter. Read it last so the action names already make sense when you see how MCP maps onto the backend API.
