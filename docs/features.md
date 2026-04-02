# Features

## CRM workspace

**Description:** I built the CRM around active sales work rather than passive contact storage. Leads carry ownership, score, priority, notes, product interest, duplicate handling, and next actions.

**Implementation anchors:** `app/frontend/src/pages/CrmPage.tsx`, `app/backend/src/routes/crm.ts`, `app/database/schema.sql`

**Notable behavior:**

- Lead records store normalized email, phone, website, and company keys for dedupe.
- Duplicate cases can become merge, keep-separate, or handover workflows.
- Lead records can store products a customer is interested in or already using.
- Activity templates can create a note and schedule the next follow-up in one motion.
- Priority buckets and lead score support queue-style work instead of flat listing.

## Calendar and follow-up management

**Description:** The calendar is part of the CRM workflow. I used one task and event model so meetings, calls, reminders, and next-contact actions can be scheduled against lead records.

**Implementation anchors:** `app/frontend/src/pages/CalendarPage.tsx`, `app/backend/src/routes/crm.ts`, `app/database/schema.sql`

**Notable behavior:**

- Tasks and events share a common table with `item_kind` and `task_type`.
- Recurrence supports daily, weekly, and monthly follow-up patterns.
- Tasks can be assigned to specific users and linked back to a lead.
- Sellers and managers work from the same follow-up system instead of separate calendar tooling.

## Invoices, payments, and margin tracking

**Description:** The invoice module tracks payment status, owner responsibility, item-level profit, margin, and grouped commercial reporting.

**Implementation anchors:** `app/frontend/src/pages/InvoicesPage.tsx`, `app/frontend/src/pages/InvoiceDetailPage.tsx`, `app/backend/src/routes/invoices.ts`, `app/backend/src/services/invoiceRecalculation.ts`

**Notable behavior:**

- Invoices store payment state, paid amount, due date, and account manager link.
- Manager commission splits can be normalized and validated server-side.
- Invoice item purchase prices can be backfilled from the product catalog.
- Margin is recalculated with exchange-rate awareness instead of assuming all invoice values are PLN.
- Dashboard summaries are derived from the same invoice records used in operations.

## Cost tracking and document parsing

**Description:** I added a costs module because profit reporting is incomplete without the extra documents and operational charges that sit outside the original invoice lines.

**Implementation anchors:** `app/frontend/src/pages/CostsPage.tsx`, `app/backend/src/routes/costs.ts`, `app/backend/src/services/costDocumentParser.ts`, `app/database/schema.sql`

**Notable behavior:**

- Costs can be attached to invoice groups and linked to one or many invoices.
- Uploads support PDFs, spreadsheets, CSV, text files, and selected image MIME types.
- Parse preview suggests amount, currency, date, document number, vendor name, and confidence before save.
- Operators can override parsed values manually when the source document is messy.
- Cost documents are stored with parse metadata so the review trail remains visible.

## Products and offer ladders

**Description:** The product area is built for commercial use, not just inventory listing. I kept it connected to invoice recalculation so purchase prices stay consistent across reporting without manual re-entry.

**Implementation anchors:** `app/frontend/src/pages/ProductsPage.tsx`, `app/database/schema.sql`

**Notable behavior:**

- Price tiers support recommended pricing by quantity.
- Commission percentage can sit alongside pricing tiers.
- Stock adjustments record manual losses such as damaged, sample, lost, or expired inventory.
- Invoice recalculation can reuse product purchase prices to keep reporting consistent.

## Sales resources and reusable email content

**Description:** I added a resources area so the team can keep offer copy, snippets, and localized versions inside the same system they use to manage leads.

**Implementation anchors:** `app/frontend/src/pages/ResourcesPage.tsx`, `app/frontend/src/components/RichEmailEditor.tsx`, `app/backend/src/routes/resources.ts`

**Notable behavior:**

- Templates can be grouped by category and tagged for search.
- Templates can have translation versions with version numbers and labels.
- The frontend formats email-ready HTML instead of leaving snippets as plain notes.
- File attachments can be stored alongside resource content.

## Team management and role-aware access

**Description:** Different roles need different work surfaces. I kept permissions explicit instead of treating every user as a full operator.

**Implementation anchors:** `app/frontend/src/utils/accessControl.ts`, `app/frontend/src/pages/UserManagementPage.tsx`, `app/backend/src/routes/auth.ts`

**Notable behavior:**

- `seller` users focus on CRM, calendar, products, and resources.
- `bookkeeping` users focus on dashboard, invoices, and costs.
- `admin` has full access including logs.
- Frontend routes and backend guards both enforce access.

## App logs and accountability

**Description:** The logs area exists so I can answer operational questions about who changed data and when.

**Implementation anchors:** `app/frontend/src/pages/LogsPage.tsx`, `app/backend/src/routes/logs.ts`, `app/database/schema.sql`

**Notable behavior:**

- Logs are admin-only.
- Filtering supports user, HTTP method, event type, search, and time range.
- The backend stores method, endpoint, status code, actor, IP, and user agent.
- Logs can be cleared deliberately from the admin UI.

## AI assistant and MCP integration

**Description:** I added natural-language access to the CRM without handing control to the model. The AI path is useful because the app already centralizes the data the team asks about most often.

**Implementation anchors:** `app/backend/src/routes/ai.ts`, `app/frontend/src/components/AiChat/AiChat.tsx`, `app/frontend/src/components/AiChat/AiChatBubble.tsx`, `app/mcp/src/index.ts`

**Notable behavior:**

- The backend defines an allowlist of supported actions.
- Forbidden or destructive requests are blocked server-side.
- The frontend AI widget can navigate the operator directly to a relevant screen after an allowed action.
- MCP exposes CRM, invoice, product, and customer tooling through the backend API instead of direct DB access.

