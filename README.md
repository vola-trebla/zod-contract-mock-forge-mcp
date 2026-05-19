# zod-contract-mock-forge-mcp

[![npm version](https://img.shields.io/npm/v/zod-contract-mock-forge-mcp.svg)](https://www.npmjs.com/package/zod-contract-mock-forge-mcp)
[![npm downloads](https://img.shields.io/npm/dm/zod-contract-mock-forge-mcp.svg)](https://www.npmjs.com/package/zod-contract-mock-forge-mcp)
[![CI](https://github.com/vola-trebla/zod-contract-mock-forge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/vola-trebla/zod-contract-mock-forge-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that turns Zod schemas into mocks, violations, and contract tests — so your AI agent can reason about API contracts without manually crafting payloads.

## The Problem

Zod schemas are runtime code. An AI agent cannot execute them, introspect their constraints, or generate valid/invalid payloads without this layer. The agent also cannot detect when the schema and the OpenAPI docs silently diverged, or whether a schema change breaks existing test fixtures.

## Tools

### Mock generation

| Tool                     | Arguments                        | What it returns                                                           |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------- |
| `generate_valid_mock`    | `schema_code`, `count?`          | Valid mock data matching the schema                                       |
| `generate_mock_variants` | `schema_code`, `count?`, `seed?` | N structurally valid but value-diverse mocks — for property-based testing |

### Violation generation

| Tool                                   | Arguments     | What it returns                                                                                |
| -------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `generate_boundary_violations`         | `schema_code` | Invalid payloads for each constraint: missing fields, type mismatches, min/max, email/uuid/url |
| `generate_exhaustive_union_violations` | `schema_code` | Per-variant violations for every branch of a `z.union()` or `z.discriminatedUnion()`           |

### Schema analysis

| Tool                        | Arguments                                                                          | What it returns                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `introspect_schema`         | `schema_code`                                                                      | JSON Schema representation — for LLM understanding of the contract                                          |
| `read_schema_from_file`     | `file_path`, `export_name?`                                                        | Extracts the Zod schema expression from a TypeScript/JS file                                                |
| `detect_schema_drift`       | `zod_file_path`, `schema_export_name`, `openapi_file_path`, `openapi_schema_name?` | Diffs Zod vs OpenAPI — reports `missing_in_openapi`, `missing_in_zod`, `type_conflict`, `required_mismatch` |
| `evaluate_schema_evolution` | `schema_file_path`, `schema_export_name`, `old_schema_content?`                    | Generates mocks from old schema, validates against new — detects breaking changes before tests run          |

### Contract testing

| Tool                         | Arguments                                                                  | What it returns                                                            |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `scaffold_api_contract_test` | `framework`, `base_url`, `endpoint`, `method`, `schema_code`, `test_name?` | Contract test boilerplate for Playwright, Jest, Vitest, or MSW             |
| `suggest_contract_fix`       | `schema_code`, `payload`                                                   | Validates a JSON payload and explains each violation with a fix suggestion |

## Setup

### 1. Install

```bash
npm install -g zod-contract-mock-forge-mcp
```

### 2. Add to your editor

#### Cursor / VS Code (`.cursor/mcp.json` or `.vscode/mcp.json`)

```json
{
  "mcpServers": {
    "zod-forge": {
      "command": "zod-contract-mock-forge-mcp"
    }
  }
}
```

#### Claude Code

```bash
claude mcp add zod-forge zod-contract-mock-forge-mcp
```

## Example usage

```
My schema file is src/schemas/user.ts, exported as UserSchema.
My OpenAPI spec is docs/openapi.yaml.

1. introspect_schema — what are the constraints on this schema?
2. generate_mock_variants — give me 10 diverse valid payloads (seed: 42) for CI reproducibility
3. generate_exhaustive_union_violations — test every branch of the role discriminated union
4. detect_schema_drift — has the Zod schema diverged from the OpenAPI docs?
5. evaluate_schema_evolution — does my schema change break any existing mock data?
```

## Example output

**`generate_mock_variants`** — 3 diverse valid mocks, seeded for CI:

```json
{
  "schema_id": "schema_a1b2c3d4",
  "count": 3,
  "all_valid": true,
  "variants": [
    { "name": "Colleen Rowe", "age": 37 },
    { "name": "Pat Reynolds", "age": 24 },
    { "name": "Veronica Konopelski", "age": 45 }
  ]
}
```

**`detect_schema_drift`** — field missing in OpenAPI, extra field in Zod:

```json
{
  "drift_count": 2,
  "drifts": [
    {
      "field_path": "role",
      "drift_type": "missing_in_openapi",
      "zod_value": "string",
      "openapi_value": null
    },
    {
      "field_path": "email",
      "drift_type": "missing_in_zod",
      "zod_value": null,
      "openapi_value": "string"
    }
  ]
}
```

**`evaluate_schema_evolution`** — new required field breaks existing mocks:

```json
{
  "breaking_change": true,
  "sample_count": 20,
  "invalid_mock_count": 20,
  "failure_reasons": [
    {
      "field_path": "status",
      "zod_code": "invalid_type",
      "expected": "string",
      "received": "undefined",
      "affected_mock_count": 20
    }
  ]
}
```

## Scripts

```bash
npm run build        # compile TypeScript → dist/
npm run lint         # ESLint
npm run format       # Prettier --write
npm run format:check # Prettier check (used in CI)
npm test             # Vitest
```

## License

MIT
