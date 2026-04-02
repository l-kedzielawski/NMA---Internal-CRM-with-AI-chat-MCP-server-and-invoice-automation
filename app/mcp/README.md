# app-mcp-server

MCP server for the internal CRM application.

This server exposes only non-destructive tools (no delete operations).
The main web app works without MCP. Use this only if you want AI tooling to call the backend through MCP.

## Setup

1. Issue an MCP token from backend:
   - `POST /api/auth/service-token`
   - Use your admin JWT
2. Create `.env` from `.env.example` and set:
   - `MCP_API_URL`
   - `MCP_API_TOKEN`
3. Install dependencies:
   - `npm install`
4. Build:
   - `npm run build`
5. Run:
   - `npm start`

## OpenCode config example

```json
{
  "mcpServers": {
    "app-crm": {
      "type": "local",
      "command": "node",
      "args": ["/absolute/path/to/app/mcp/dist/index.js"],
      "env": {
        "MCP_API_URL": "${MCP_API_URL}",
        "MCP_API_TOKEN": "${MCP_API_TOKEN}"
      }
    }
  }
}
```

## Available tools

- `create_lead`
- `list_leads`
- `search_leads`
- `get_lead`
- `update_lead`
- `add_activity`
- `create_task`
- `list_tasks`
- `list_invoices`
- `get_dashboard`
- `list_products`
- `search_products`
- `list_customers`
- `search_customers`
