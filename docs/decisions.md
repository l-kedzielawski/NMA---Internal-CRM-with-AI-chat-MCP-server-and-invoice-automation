# Engineering Decisions

### Build a custom internal platform instead of adopting SuiteCRM

- **Context:** We needed CRM, calendar follow-ups, invoice control, payout visibility, product pricing, and internal knowledge in one place.
- **Options considered:** Use an off-the-shelf CRM and bolt on finance workflows later; keep CRM and finance in separate tools; build a focused internal app.
- **Decision:** I built a custom internal platform around the actual operating workflow.
- **Why:** The main issue was not storing leads. The issue was that follow-ups, invoice status, margin tracking, and team payouts all depended on each other. A generic CRM would still leave key work in spreadsheets or inboxes.

### Keep business calculations on the backend

- **Context:** Margin, profit, exchange-rate handling, grouped costs, and manager commission affect reporting and payouts.
- **Options considered:** Calculate summaries in the frontend; store only final totals; centralize recalculation logic on the backend.
- **Decision:** I kept recalculation logic in backend services and routes.
- **Why:** The backend is the only place where role checks, linked invoices, product prices, logistics cost, and exchange rates can be combined consistently. It also prevents different screens from drifting into slightly different math.

### Parse uploaded source documents instead of treating them as attachments only

- **Context:** Invoices and cost documents are useful only if their numbers can feed the operational workflow.
- **Options considered:** Store files without parsing; parse only invoices; parse invoices and vendor cost documents with confidence scoring.
- **Decision:** I added parser services for invoice PDFs and cost documents.
- **Why:** Manual re-entry is slow and error-prone. Parsing gives the operator a starting point, while still allowing manual correction when a document is messy.

### Model grouped costs explicitly

- **Context:** Some costs belong to a set of invoices or a broader shipment rather than a single invoice line.
- **Options considered:** Ignore those costs; attach each cost to one invoice only; create invoice groups and separate cost entry records.
- **Decision:** I added `invoice_groups`, `cost_entries`, `cost_documents`, and invoice-cost linking tables.
- **Why:** That made it possible to represent the business more honestly. Margin reporting becomes more useful when shared costs can be attached to the right commercial batch.

### Use role-based access with different default work areas

- **Context:** Sellers, managers, bookkeeping, and admins do not need the same screens or permissions.
- **Options considered:** Give every role the same UI; hide fields visually but keep broad API access; enforce role-based access in both frontend and backend.
- **Decision:** I used route-level access control in the frontend and backend role guards in the API.
- **Why:** The frontend improves navigation, but the backend is where access has to be enforced. Sellers focus on CRM and calendar. Bookkeeping focuses on invoices and costs. Admins get logs and full control.

### Keep audit logging as a first-class feature

- **Context:** This app is used to run day-to-day company operations, so changes need traceability.
- **Options considered:** Keep only server logs; log auth events only; maintain an application-level audit log table.
- **Decision:** I used an `app_audit_logs` table and an admin log screen.
- **Why:** I wanted a business-facing record of who changed what, not just infrastructure logs. That matters for operational debugging and accountability.

### Add AI, but only through an allowlisted backend action layer

- **Context:** Natural-language access is useful for CRM and dashboard queries, but unrestricted model actions are unsafe.
- **Options considered:** No AI access; let the model call routes freely; expose only explicit actions validated by the backend.
- **Decision:** I built an AI route with action allowlists, role checks, and audit logging.
- **Why:** I wanted the convenience of AI without letting the model invent its own permissions or write paths.

### Keep MCP as a separate package

- **Context:** I wanted AI tooling outside the browser to interact with the app, but I did not want the web app to absorb MCP concerns.
- **Options considered:** No MCP support; fold MCP into the main backend; keep MCP as a separate integration package.
- **Decision:** I kept `app/mcp/` separate and pointed it at the backend API.
- **Why:** That makes the integration easier to reason about. The backend stays the source of truth, and MCP remains a thin, replaceable adapter.
