#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import process from "node:process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { generateMock } from "@anatine/zod-mock";
import { faker } from "@faker-js/faker";

/**
 * Utility to parse a Zod schema from a string.
 * It expects the string to be a valid JS expression that returns a Zod schema.
 * Example: "z.object({ name: z.string() })"
 */
function parseZodSchema(schemaCode: string): z.ZodTypeAny {
  try {
    // Remove potential "import" or "const" if the user provided a full snippet
    // This is a naive cleanup, but works for common MCP use cases
    const cleanCode = schemaCode
      .replace(/import\s+.*\s+from\s+['"]zod['"];?/g, "")
      .replace(/const\s+\w+\s*=\s*/g, "")
      .trim();

    const fn = new Function("z", `return ${cleanCode}`);
    const schema = fn(z);

    if (!(schema instanceof z.ZodType)) {
      throw new Error("The provided code did not return a valid Zod schema.");
    }

    return schema;
  } catch (error) {
    throw new Error(`Failed to parse Zod schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generates intentional boundary violations based on a Zod schema.
 */
function generateViolations(schema: z.ZodTypeAny): Array<{ type: string; payload: any; description: string }> {
  const violations: Array<{ type: string; payload: any; description: string }> = [];
  const validMock = generateMock(schema);

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const key in shape) {
      const fieldSchema = shape[key];

      // 1. Omit required fields
      if (!fieldSchema.isOptional() && !fieldSchema.isNullable()) {
        const payload = { ...validMock };
        delete payload[key];
        violations.push({
          type: "MISSING_REQUIRED_FIELD",
          payload,
          description: `Field '${key}' is required but omitted.`,
        });
      }

      // 2. Type mismatch (send string for number, etc.)
      if (fieldSchema instanceof z.ZodNumber) {
        const payload = { ...validMock, [key]: "not-a-number" };
        violations.push({
          type: "TYPE_MISMATCH",
          payload,
          description: `Field '${key}' expected number, got string.`,
        });
      } else if (fieldSchema instanceof z.ZodString) {
        const payload = { ...validMock, [key]: 12345 };
        violations.push({
          type: "TYPE_MISMATCH",
          payload,
          description: `Field '${key}' expected string, got number.`,
        });
      }
    }
  }

  return violations;
}

const server = new Server(
  {
    name: "zod-contract-mock-forge-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "introspect_schema",
        description: "Convert a Zod schema string to JSON Schema for LLM understanding",
        inputSchema: {
          type: "object",
          properties: {
            schemaCode: {
              type: "string",
              description: "Zod schema code (e.g., 'z.object({ name: z.string() })')",
            },
          },
          required: ["schemaCode"],
        },
      },
      {
        name: "generate_valid_mock",
        description: "Generate valid mock data from a Zod schema",
        inputSchema: {
          type: "object",
          properties: {
            schemaCode: { type: "string" },
            count: { type: "number", default: 1 },
          },
          required: ["schemaCode"],
        },
      },
      {
        name: "generate_boundary_violations",
        description: "Generate intentional boundary violations for negative testing",
        inputSchema: {
          type: "object",
          properties: {
            schemaCode: { type: "string" },
          },
          required: ["schemaCode"],
        },
      },
      {
        name: "scaffold_api_contract_test",
        description: "Generate a Playwright API contract test boilerplate",
        inputSchema: {
          type: "object",
          properties: {
            baseUrl: { type: "string", default: "http://localhost:3000" },
            endpoint: { type: "string", description: "e.g., /api/users" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET" },
            schemaCode: { type: "string" },
            testName: { type: "string", default: "API Contract Validation" },
          },
          required: ["endpoint", "schemaCode"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "introspect_schema") {
      const schema = parseZodSchema(String(args?.schemaCode));
      const jsonSchema = zodToJsonSchema(schema);
      return {
        content: [{ type: "text", text: JSON.stringify(jsonSchema, null, 2) }],
      };
    }

    if (name === "generate_valid_mock") {
      const schema = parseZodSchema(String(args?.schemaCode));
      const count = Number(args?.count || 1);
      const mocks = Array.from({ length: count }, () => generateMock(schema));
      return {
        content: [{ type: "text", text: JSON.stringify(count === 1 ? mocks[0] : mocks, null, 2) }],
      };
    }

    if (name === "generate_boundary_violations") {
      const schema = parseZodSchema(String(args?.schemaCode));
      const violations = generateViolations(schema);
      return {
        content: [{ type: "text", text: JSON.stringify(violations, null, 2) }],
      };
    }

    if (name === "scaffold_api_contract_test") {
      const { baseUrl, endpoint, method, schemaCode, testName } = args as any;
      
      const testCode = `
import { test, expect } from '@playwright/test';
import { z } from 'zod';

const schema = ${schemaCode};

test('${testName}', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${baseUrl}${endpoint}');
  
  expect(response.ok()).toBeTruthy();
  
  const body = await response.json();
  
  // Validate contract
  const result = schema.safeParse(body);
  
  if (!result.success) {
    console.error('Contract violation:', result.error.format());
  }
  
  expect(result.success).toBe(true);
});
`.trim();

      return {
        content: [{ type: "text", text: testCode }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
