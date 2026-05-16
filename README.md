# zod-contract-mock-forge-mcp

MCP server for deterministic mock generation and API contract scaffolding using Zod schemas.

## Features
- `generate_valid_mock`: Create valid payloads based on Zod schemas.
- `generate_boundary_violations`: Create invalid payloads for negative testing.
- `scaffold_api_contract_test`: Generate Playwright test boilerplate.

## Installation
```bash
npm install
npm run build
```

## Usage with Claude Desktop
Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zod-mock-forge": {
      "command": "node",
      "args": ["/path/to/zod-contract-mock-forge-mcp/dist/index.js"]
    }
  }
}
```
