#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { generateMock } from "@anatine/zod-mock";
import { faker } from "@faker-js/faker";

/**
 * Utility to parse a Zod schema from a string.
 * It expects the string to be a valid JS expression that returns a Zod schema.
 * Example: "z.object({ name: z.string() })"
 */
export function parseZodSchema(schemaCode: string): z.ZodTypeAny {
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
export function generateViolations(schema: z.ZodTypeAny): Array<{ type: string; payload: any; description: string }> {
  const violations: Array<{ type: string; payload: any; description: string }> = [];
  const baseMock = generateMock(schema);

  function clone(obj: any) {
    return JSON.parse(JSON.stringify(obj));
  }

  function setAtPath(obj: any, path: string[], value: any) {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (current[path[i]] === undefined) return;
      current = current[path[i]];
    }
    const lastKey = path[path.length - 1];
    if (value === undefined) {
      if (Array.isArray(current)) {
        current.splice(Number(lastKey), 1);
      } else {
        delete current[lastKey];
      }
    } else {
      current[lastKey] = value;
    }
  }

  function walk(currentSchema: z.ZodTypeAny, path: string[]) {
    let target = currentSchema;

    while (
      target instanceof z.ZodOptional ||
      target instanceof z.ZodNullable ||
      target instanceof z.ZodDefault
    ) {
      if (target instanceof z.ZodOptional) {
        target = target.unwrap();
      } else if (target instanceof z.ZodNullable) {
        target = target.unwrap();
      } else if (target instanceof z.ZodDefault) {
        target = target._def.innerType;
      }
    }

    const pathStr = path.length > 0 ? path.join(".") : "root";

    if (target instanceof z.ZodString) {
      const p = clone(baseMock);
      setAtPath(p, path, 12345);
      violations.push({
        type: "TYPE_MISMATCH",
        payload: p,
        description: `Field '${pathStr}' expected string, got number.`,
      });

      const checks = (target as z.ZodString)._def.checks;
      for (const check of checks) {
        if (check.kind === "email") {
          const p2 = clone(baseMock);
          setAtPath(p2, path, "invalid-email");
          violations.push({
            type: "INVALID_EMAIL",
            payload: p2,
            description: `Field '${pathStr}' expected valid email.`,
          });
        }
        if (check.kind === "url") {
          const p2 = clone(baseMock);
          setAtPath(p2, path, "not-a-url");
          violations.push({
            type: "INVALID_URL",
            payload: p2,
            description: `Field '${pathStr}' expected valid URL.`,
          });
        }
        if (check.kind === "uuid") {
          const p2 = clone(baseMock);
          setAtPath(p2, path, "not-a-uuid");
          violations.push({
            type: "INVALID_UUID",
            payload: p2,
            description: `Field '${pathStr}' expected valid UUID.`,
          });
        }
      }
    } else if (target instanceof z.ZodNumber) {
      const p = clone(baseMock);
      setAtPath(p, path, "not-a-number");
      violations.push({
        type: "TYPE_MISMATCH",
        payload: p,
        description: `Field '${pathStr}' expected number, got string.`,
      });

      const checks = (target as z.ZodNumber)._def.checks;
      for (const check of checks) {
        if (check.kind === "min") {
          const p2 = clone(baseMock);
          setAtPath(p2, path, (check as any).value - 1);
          violations.push({
            type: "MIN_VALUE_VIOLATION",
            payload: p2,
            description: `Field '${pathStr}' expected min ${(check as any).value}.`,
          });
        }
        if (check.kind === "max") {
          const p2 = clone(baseMock);
          setAtPath(p2, path, (check as any).value + 1);
          violations.push({
            type: "MAX_VALUE_VIOLATION",
            payload: p2,
            description: `Field '${pathStr}' expected max ${(check as any).value}.`,
          });
        }
      }
    } else if (target instanceof z.ZodBoolean) {
      const p = clone(baseMock);
      setAtPath(p, path, "not-a-boolean");
      violations.push({
        type: "TYPE_MISMATCH",
        payload: p,
        description: `Field '${pathStr}' expected boolean, got string.`,
      });
    } else if (target instanceof z.ZodObject) {
      const shape = target.shape;
      for (const key in shape) {
        const fieldSchema = shape[key];
        const fieldPath = [...path, key];

        let isFieldOptional = false;
        let t = fieldSchema;
        while (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
          isFieldOptional = true;
          if (t instanceof z.ZodOptional) t = t.unwrap();
          else t = t._def.innerType;
        }

        if (!isFieldOptional) {
          const p = clone(baseMock);
          setAtPath(p, fieldPath, undefined);
          violations.push({
            type: "MISSING_REQUIRED_FIELD",
            payload: p,
            description: `Field '${fieldPath.join(".")}' is required.`,
          });
        }

        walk(fieldSchema, fieldPath);
      }
    } else if (target instanceof z.ZodArray) {
      const elementSchema = target.element;
      const currentData = path.reduce((obj, key) => obj?.[key], baseMock);
      if (Array.isArray(currentData) && currentData.length > 0) {
        walk(elementSchema, [...path, "0"]);
      }

      const checks = (target as any)._def.checks;
      if (checks) {
        for (const check of checks) {
          if (check.kind === "min") {
            const p = clone(baseMock);
            setAtPath(p, path, []);
            violations.push({
              type: "MIN_LENGTH_VIOLATION",
              payload: p,
              description: `Field '${pathStr}' expected min length ${(check as any).value}.`,
            });
          }
        }
      }
    }
  }

  walk(schema, []);
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
        name: "read_schema_from_file",
        description: "Read a Zod schema directly from a file in the workspace",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the .ts or .js file containing the Zod schema",
            },
            exportName: {
              type: "string",
              description: "Name of the exported schema variable (optional, if not provided it will try to find any Zod object)",
            },
          },
          required: ["filePath"],
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
      {
        name: "suggest_contract_fix",
        description: "Suggest fixes for Zod validation errors, either by modifying the schema or the payload",
        inputSchema: {
          type: "object",
          properties: {
            schemaCode: { type: "string" },
            payload: { type: "string", description: "JSON string of the failing payload" },
          },
          required: ["schemaCode", "payload"],
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

    if (name === "read_schema_from_file") {
      const filePath = String(args?.filePath);
      const exportName = args?.exportName ? String(args?.exportName) : undefined;
      
      const content = await readFile(filePath, "utf-8");
      
      let schemaCode = "";
      
      if (exportName) {
        // Try to find the specific export
        const regex = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${exportName}\\s*=\\s*([\\s\\S]*?)(?:;|$)`, "m");
        const match = content.match(regex);
        if (match) {
          schemaCode = match[1].trim();
        } else {
          throw new Error(`Could not find export '${exportName}' in ${filePath}`);
        }
      } else {
        // Try to find anything that looks like a Zod object
        const zodRegex = /z\.(object|array|string|number|boolean|enum|record)\([\s\S]*?\)/m;
        const match = content.match(zodRegex);
        if (match) {
          schemaCode = match[0].trim();
        } else {
          // If no Zod match, just return the content and let the LLM handle it
          return {
            content: [
              { type: "text", text: `Could not automatically extract Zod schema from ${filePath}. Returning raw content:` },
              { type: "text", text: content }
            ],
          };
        }
      }

      return {
        content: [
          { type: "text", text: `Extracted schema from ${filePath}:` },
          { type: "text", text: schemaCode }
        ],
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

    if (name === "suggest_contract_fix") {
      const schema = parseZodSchema(String(args?.schemaCode));
      let payloadObj;
      try {
        payloadObj = JSON.parse(String(args?.payload));
      } catch (e) {
        throw new Error("Payload must be valid JSON");
      }

      const result = schema.safeParse(payloadObj);
      if (result.success) {
        return {
          content: [{ type: "text", text: "The payload is valid against the schema. No fixes needed." }],
        };
      }

      const issues = result.error.issues;
      let suggestions = "Contract Violation Detected.\\n\\n";
      
      issues.forEach((issue, index) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        suggestions += `Issue ${index + 1}: At '${path}', ${issue.message}\\n`;
        suggestions += `  -> To fix data: Ensure the payload provides a valid value for '${path}'.\\n`;
        
        let schemaFix = `If this is expected, you might need to make '${path}' optional(), nullable(), or change its type.`;
        if (issue.code === "invalid_type" && issue.received === "undefined") {
          schemaFix = `Make '${path}' optional: z...optional()`;
        } else if (issue.code === "invalid_type" && issue.received === "null") {
          schemaFix = `Make '${path}' nullable: z...nullable()`;
        } else if (issue.code === "invalid_type") {
          schemaFix = `Change the type of '${path}' to match the received type (${issue.received}).`;
        }
        
        suggestions += `  -> To fix schema: ${schemaFix}\\n\\n`;
      });

      return {
        content: [{ type: "text", text: suggestions }],
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
