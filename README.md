# zod-contract-mock-forge-mcp 🐸⚒️

[![npm version](https://img.shields.io/npm/v/zod-contract-mock-forge-mcp.svg)](https://www.npmjs.com/package/zod-contract-mock-forge-mcp)
[![npm downloads](https://img.shields.io/npm/dm/zod-contract-mock-forge-mcp.svg)](https://www.npmjs.com/package/zod-contract-mock-forge-mcp)
[![CI](https://github.com/vola-trebla/zod-contract-mock-forge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/zod-contract-mock-forge-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**zod-contract-mock-forge-mcp** is a powerful Model Context Protocol (MCP) server designed to bridge the gap between Zod schemas and automated testing. It empowers AI agents to perform deterministic mock generation, deep boundary testing, and API contract scaffolding with ease.

---

## 🚀 Features

### 1. 📂 Intelligent Schema Discovery

Read Zod schemas directly from your project files. No more copy-pasting code into the chat.

- **Tool:** `read_schema_from_file`
- **Support:** Automatically detects Zod objects or extracts specific exports.

### 2. 🎲 Deterministic Mock Generation

Generate high-quality, valid mock data based on your Zod definitions using `@anatine/zod-mock` and `@faker-js/faker`.

- **Tool:** `generate_valid_mock`

### 3. 🧨 Deep Boundary Violation Testing (Negative Testing)

Automatically generate "poisoned" payloads to test your API's resilience. Unlike simple generators, this tool performs **recursive mutation** for deep objects and arrays.

- **Tool:** `generate_boundary_violations`
- **Supported Violations:** Missing required fields, type mismatches (at any depth), string constraints (email, uuid, url), and numeric/array limits (min/max).

### 4. 📜 Multi-Framework Test Scaffolding

Quickly scaffold contract tests or mock handlers for your favorite tools.

- **Tool:** `scaffold_api_contract_test`
- **Supported Frameworks:** Playwright, Jest, Vitest, and MSW (Mock Service Worker).

### 5. 🛠️ Smart Contract Fixer

Struggling with a validation error? The Smart Fixer analyzes Zod error issues and provides actionable advice on how to fix the data or relax the schema.

- **Tool:** `suggest_contract_fix`

### 6. 🧠 LLM-Friendly Introspection

Convert Zod schemas into JSON Schema (Draft 7/OpenAPI) to help LLMs understand the contract structure better.

- **Tool:** `introspect_schema`

---

## 🛠️ Installation

```bash
npm install
npm run build
```

---

## ⚙️ Configuration

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "zod-mock-forge": {
      "command": "node",
      "args": ["/absolute/path/to/zod-contract-mock-forge-mcp/dist/index.js"]
    }
  }
}
```

---

## 🧪 Development & Testing

The project uses **Vitest** for unit and integration testing.

```bash
# Run tests
npm test

# Build project
npm run build

# Lint and Format
npm run lint
npm run format
```

---

## 📝 License

MIT
