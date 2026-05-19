#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { generateMock } from '@anatine/zod-mock';
import * as yaml from 'js-yaml';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { realpathSync } from 'node:fs';

export function parseZodSchema(schemaCode: string): z.ZodTypeAny {
  try {
    const cleanCode = schemaCode
      .replace(/import\s+.*\s+from\s+['"]zod['"];?/g, '')
      .replace(/const\s+\w+\s*=\s*/g, '')
      .trim();

    const fn = new Function('z', `return ${cleanCode}`);
    const schema = fn(z);

    if (!(schema instanceof z.ZodType)) {
      throw new Error('The provided code did not return a valid Zod schema.');
    }

    return schema;
  } catch (error) {
    throw new Error(
      `Failed to parse Zod schema: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function generateViolations(
  schema: z.ZodTypeAny
): Array<{ type: string; payload: unknown; description: string }> {
  const violations: Array<{ type: string; payload: unknown; description: string }> = [];
  const baseMock = generateMock(schema);

  function setAtPath(obj: Record<string, unknown>, path: string[], value: unknown) {
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (current[path[i]] === undefined) return;
      current = current[path[i]] as Record<string, unknown>;
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

  const addViolation = (path: string[], type: string, value: unknown, description: string) => {
    const payload = structuredClone(baseMock);
    setAtPath(payload as Record<string, unknown>, path, value);
    violations.push({ type, payload, description });
  };

  function walk(currentSchema: z.ZodTypeAny, path: string[]) {
    let target = currentSchema;

    while (
      target instanceof z.ZodOptional ||
      target instanceof z.ZodNullable ||
      target instanceof z.ZodDefault
    ) {
      if (target instanceof z.ZodOptional) target = target.unwrap();
      else if (target instanceof z.ZodNullable) target = target.unwrap();
      else if (target instanceof z.ZodDefault) target = target._def.innerType;
    }

    const pathStr = path.length > 0 ? path.join('.') : 'root';

    if (target instanceof z.ZodString) {
      addViolation(path, 'TYPE_MISMATCH', 12345, `Field '${pathStr}' expected string, got number.`);
      for (const check of (target as z.ZodString)._def.checks) {
        if (check.kind === 'email')
          addViolation(
            path,
            'INVALID_EMAIL',
            'invalid-email',
            `Field '${pathStr}' expected valid email.`
          );
        if (check.kind === 'url')
          addViolation(path, 'INVALID_URL', 'not-a-url', `Field '${pathStr}' expected valid URL.`);
        if (check.kind === 'uuid')
          addViolation(
            path,
            'INVALID_UUID',
            'not-a-uuid',
            `Field '${pathStr}' expected valid UUID.`
          );
      }
    } else if (target instanceof z.ZodNumber) {
      addViolation(
        path,
        'TYPE_MISMATCH',
        'not-a-number',
        `Field '${pathStr}' expected number, got string.`
      );
      for (const check of (target as z.ZodNumber)._def.checks) {
        if (check.kind === 'min')
          addViolation(
            path,
            'MIN_VALUE_VIOLATION',
            (check as { value: number }).value - 1,
            `Field '${pathStr}' expected min ${(check as { value: number }).value}.`
          );
        if (check.kind === 'max')
          addViolation(
            path,
            'MAX_VALUE_VIOLATION',
            (check as { value: number }).value + 1,
            `Field '${pathStr}' expected max ${(check as { value: number }).value}.`
          );
      }
    } else if (target instanceof z.ZodBoolean) {
      addViolation(
        path,
        'TYPE_MISMATCH',
        'not-a-boolean',
        `Field '${pathStr}' expected boolean, got string.`
      );
    } else if (target instanceof z.ZodEnum) {
      addViolation(
        path,
        'INVALID_ENUM_VALUE',
        'invalid_enum_val',
        `Field '${pathStr}' expected one of: ${(target as z.ZodEnum<[string, ...string[]]>)._def.values.join(', ')}`
      );
    } else if (target instanceof z.ZodObject) {
      const shape = target.shape as Record<string, z.ZodTypeAny>;
      for (const key in shape) {
        const fieldSchema = shape[key];
        const fieldPath = [...path, key];

        let isFieldOptional = false;
        let t: z.ZodTypeAny = fieldSchema;
        while (t instanceof z.ZodOptional || t instanceof z.ZodDefault) {
          isFieldOptional = true;
          if (t instanceof z.ZodOptional) t = t.unwrap();
          else t = t._def.innerType;
        }

        if (!isFieldOptional) {
          addViolation(
            fieldPath,
            'MISSING_REQUIRED_FIELD',
            undefined,
            `Field '${fieldPath.join('.')}' is required.`
          );
        }
        walk(fieldSchema, fieldPath);
      }
    } else if (target instanceof z.ZodArray) {
      const elementSchema = (target as z.ZodArray<z.ZodTypeAny>).element;
      const currentData = path.reduce(
        (obj: unknown, key) => (obj as Record<string, unknown>)?.[key],
        baseMock
      );
      if (Array.isArray(currentData) && currentData.length > 0) {
        walk(elementSchema, [...path, '0']);
      }

      const checks = (target as z.ZodArray<z.ZodTypeAny>)._def.minLength;
      if (checks) {
        addViolation(
          path,
          'MIN_LENGTH_VIOLATION',
          [],
          `Field '${pathStr}' expected min length ${checks.value}.`
        );
      }
    }
  }

  walk(schema, []);
  return violations;
}

interface VariantPayload {
  violation_type:
    | 'missing_discriminator'
    | 'wrong_discriminator_value'
    | 'required_field_type_mismatch'
    | 'missing_required_field';
  payload: unknown;
  description: string;
}

interface UnionVariantViolations {
  variant_index: number;
  variant_description: string;
  payloads: VariantPayload[];
}

interface ExhaustiveUnionViolationsResult {
  union_type: 'discriminated' | 'plain';
  discriminator_key?: string;
  total_variants: number;
  violations: UnionVariantViolations[];
}

function requiredFieldsOf(shape: Record<string, z.ZodTypeAny>): string[] {
  return Object.keys(shape).filter((k) => {
    let t: z.ZodTypeAny = shape[k];
    while (t instanceof z.ZodDefault) t = t._def.innerType;
    return !(t instanceof z.ZodOptional);
  });
}

function wrongTypeFor(fieldSchema: z.ZodTypeAny): unknown {
  let t = fieldSchema;
  while (t instanceof z.ZodOptional || t instanceof z.ZodDefault || t instanceof z.ZodNullable) {
    if (t instanceof z.ZodOptional) t = t.unwrap();
    else if (t instanceof z.ZodNullable) t = t.unwrap();
    else t = t._def.innerType;
  }
  return t instanceof z.ZodNumber ? 'not-a-number' : 99999;
}

export function generateExhaustiveUnionViolations(
  schema: z.ZodTypeAny
): ExhaustiveUnionViolationsResult {
  let inner = schema;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
    inner = inner.unwrap();
  }

  if (inner instanceof z.ZodDiscriminatedUnion) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (inner as any)._def as {
      discriminator: string;
      optionsMap: Map<string, z.ZodObject<z.ZodRawShape>>;
    };
    const discriminator = def.discriminator;
    const optionsMap = def.optionsMap;
    const allKeys = Array.from(optionsMap.keys());
    const violations: UnionVariantViolations[] = [];
    let variantIndex = 0;

    for (const [discKey, variantSchema] of optionsMap.entries()) {
      const baseMock = generateMock(variantSchema) as Record<string, unknown>;
      const payloads: VariantPayload[] = [];

      const missingDisc = structuredClone(baseMock);
      delete missingDisc[discriminator];
      payloads.push({
        violation_type: 'missing_discriminator',
        payload: missingDisc,
        description: `Missing discriminator key '${discriminator}' for variant '${discKey}'.`,
      });

      const wrongDisc = structuredClone(baseMock);
      wrongDisc[discriminator] = '__invalid__';
      payloads.push({
        violation_type: 'wrong_discriminator_value',
        payload: wrongDisc,
        description: `Discriminator '${discriminator}' set to unknown value (valid: ${allKeys.join(', ')}).`,
      });

      const shape = variantSchema.shape;
      const required = requiredFieldsOf(shape).filter((k) => k !== discriminator);
      if (required.length > 0) {
        const field = required[0];
        const wrongTyped = structuredClone(baseMock);
        wrongTyped[field] = wrongTypeFor(shape[field]);
        payloads.push({
          violation_type: 'required_field_type_mismatch',
          payload: wrongTyped,
          description: `Field '${field}' in variant '${discKey}' has wrong type.`,
        });
      }

      violations.push({
        variant_index: variantIndex++,
        variant_description: `${discriminator} = "${discKey}"`,
        payloads,
      });
    }

    return {
      union_type: 'discriminated',
      discriminator_key: discriminator,
      total_variants: optionsMap.size,
      violations,
    };
  }

  if (inner instanceof z.ZodUnion) {
    const options = (inner as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)._def.options;
    const violations: UnionVariantViolations[] = [];

    for (let i = 0; i < options.length; i++) {
      const variantSchema = options[i];
      let unwrapped = variantSchema;
      while (unwrapped instanceof z.ZodOptional || unwrapped instanceof z.ZodNullable) {
        unwrapped = unwrapped.unwrap();
      }
      const payloads: VariantPayload[] = [];

      if (unwrapped instanceof z.ZodObject) {
        const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
        const baseMock = generateMock(variantSchema) as Record<string, unknown>;
        const required = requiredFieldsOf(shape);

        if (required.length > 0) {
          const field = required[0];
          const missingPayload = structuredClone(baseMock);
          delete missingPayload[field];
          payloads.push({
            violation_type: 'missing_required_field',
            payload: missingPayload,
            description: `Variant ${i}: field '${field}' is required but missing.`,
          });

          const wrongTyped = structuredClone(baseMock);
          wrongTyped[field] = wrongTypeFor(shape[field]);
          payloads.push({
            violation_type: 'required_field_type_mismatch',
            payload: wrongTyped,
            description: `Variant ${i}: field '${field}' has wrong type.`,
          });
        }
      } else {
        const wrongValue = unwrapped instanceof z.ZodNumber ? 'not-a-number' : 99999;
        payloads.push({
          violation_type: 'required_field_type_mismatch',
          payload: wrongValue,
          description: `Variant ${i}: wrong primitive type provided.`,
        });
      }

      violations.push({
        variant_index: i,
        variant_description: `union variant ${i}`,
        payloads,
      });
    }

    return { union_type: 'plain', total_variants: options.length, violations };
  }

  throw new Error(
    'Schema must be z.union() or z.discriminatedUnion() — use generate_boundary_violations for other types.'
  );
}

interface MockVariantsResult {
  schema_id: string;
  count: number;
  variants: unknown[];
  all_valid: boolean;
}

function deriveSchemaId(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (Math.imul(31, h) + code.charCodeAt(i)) | 0;
  }
  return `schema_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function generateMockVariants(
  schema: z.ZodTypeAny,
  schemaCode: string,
  count: number,
  seed?: number
): MockVariantsResult {
  const variants = Array.from({ length: count }, (_, i) =>
    generateMock(schema, seed !== undefined ? { seed: seed + i } : undefined)
  );
  const all_valid = variants.every((v) => schema.safeParse(v).success);
  return { schema_id: deriveSchemaId(schemaCode), count: variants.length, variants, all_valid };
}

export interface SchemaDrift {
  field_path: string;
  drift_type: 'missing_in_openapi' | 'missing_in_zod' | 'type_conflict' | 'required_mismatch';
  zod_value: string | null;
  openapi_value: string | null;
}

export interface DetectSchemaDriftResult {
  zod_schema_name: string;
  openapi_schema_name: string;
  drift_count: number;
  drifts: SchemaDrift[];
}

type JsonSchemaObject = {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  [key: string]: unknown;
};

function normalizeType(t: string): string {
  return t === 'integer' ? 'number' : t;
}

function diffJsonSchemas(
  zodSchema: JsonSchemaObject,
  openApiSchema: JsonSchemaObject,
  path: string,
  drifts: SchemaDrift[]
): void {
  const zodProps = zodSchema.properties ?? {};
  const openApiProps = openApiSchema.properties ?? {};
  const zodRequired = new Set(zodSchema.required ?? []);
  const openApiRequired = new Set(openApiSchema.required ?? []);
  const allFields = new Set([...Object.keys(zodProps), ...Object.keys(openApiProps)]);

  for (const field of allFields) {
    const fieldPath = path ? `${path}.${field}` : field;
    const inZod = field in zodProps;
    const inOpenApi = field in openApiProps;

    if (inZod && !inOpenApi) {
      drifts.push({
        field_path: fieldPath,
        drift_type: 'missing_in_openapi',
        zod_value: zodProps[field].type ?? 'unknown',
        openapi_value: null,
      });
    } else if (!inZod && inOpenApi) {
      drifts.push({
        field_path: fieldPath,
        drift_type: 'missing_in_zod',
        zod_value: null,
        openapi_value: openApiProps[field].type ?? 'unknown',
      });
    } else {
      const zf = zodProps[field];
      const of_ = openApiProps[field];

      if (zf.type && of_.type && normalizeType(zf.type) !== normalizeType(of_.type)) {
        drifts.push({
          field_path: fieldPath,
          drift_type: 'type_conflict',
          zod_value: zf.type,
          openapi_value: of_.type,
        });
      }

      const zodIsRequired = zodRequired.has(field);
      const openApiIsRequired = openApiRequired.has(field);
      if (zodIsRequired !== openApiIsRequired) {
        drifts.push({
          field_path: fieldPath,
          drift_type: 'required_mismatch',
          zod_value: zodIsRequired ? 'required' : 'optional',
          openapi_value: openApiIsRequired ? 'required' : 'optional',
        });
      }

      if (zf.type === 'object' || of_.type === 'object') {
        diffJsonSchemas(zf, of_, fieldPath, drifts);
      }
    }
  }
}

function extractSchemaFromOpenApi(parsed: unknown, schemaName: string): JsonSchemaObject {
  const doc = parsed as Record<string, unknown>;
  const components = doc.components as Record<string, unknown> | undefined;
  const schemas = components?.schemas as Record<string, unknown> | undefined;
  if (schemas && schemaName in schemas) {
    return schemas[schemaName] as JsonSchemaObject;
  }
  // Also try top-level definitions (older OpenAPI / Swagger 2)
  const definitions = doc.definitions as Record<string, unknown> | undefined;
  if (definitions && schemaName in definitions) {
    return definitions[schemaName] as JsonSchemaObject;
  }
  throw new Error(
    `Schema '${schemaName}' not found in components.schemas or definitions of the OpenAPI file.`
  );
}

function extractZodCodeFromFile(content: string, exportName: string): string {
  // No 'm' flag: without it '$' matches end of full string, so the lazy
  // [\s\S]*? correctly captures the whole multi-line expression up to the
  // terminating semicolon rather than stopping at the first newline.
  const regex = new RegExp(
    `(?:export\\s+)?(?:const|let|var)\\s+${exportName}\\s*=\\s*([\\s\\S]*?)(?:;|$)`
  );
  const match = content.match(regex);
  if (!match) {
    throw new Error(`Could not find export '${exportName}' in the Zod file.`);
  }
  return match[1].trim();
}

export async function detectSchemaDrift(
  zodFilePath: string,
  openApiFilePath: string,
  schemaExportName: string,
  openApiSchemaName?: string
): Promise<DetectSchemaDriftResult> {
  const resolvedOpenApiName = openApiSchemaName ?? schemaExportName;

  const zodFileContent = await readFile(zodFilePath, 'utf-8');
  const schemaCode = extractZodCodeFromFile(zodFileContent, schemaExportName);
  const zodSchema = parseZodSchema(schemaCode);
  const zodJsonSchema = zodToJsonSchema(zodSchema) as JsonSchemaObject;

  const openApiContent = await readFile(openApiFilePath, 'utf-8');
  const parsedOpenApi =
    openApiFilePath.endsWith('.yaml') || openApiFilePath.endsWith('.yml')
      ? yaml.load(openApiContent)
      : JSON.parse(openApiContent);

  const openApiSchema = extractSchemaFromOpenApi(parsedOpenApi, resolvedOpenApiName);

  const drifts: SchemaDrift[] = [];
  diffJsonSchemas(zodJsonSchema, openApiSchema, '', drifts);

  return {
    zod_schema_name: schemaExportName,
    openapi_schema_name: resolvedOpenApiName,
    drift_count: drifts.length,
    drifts,
  };
}

export interface FailureReason {
  field_path: string;
  zod_code: string;
  expected: string;
  received: string;
  message: string;
  affected_mock_count: number;
}

export interface EvaluateSchemaEvolutionResult {
  breaking_change: boolean;
  sample_count: number;
  invalid_mock_count: number;
  failure_reasons: FailureReason[];
}

export function evaluateSchemaEvolution(
  oldSchemaCode: string,
  newSchemaCode: string,
  sampleCount = 20
): EvaluateSchemaEvolutionResult {
  const oldSchema = parseZodSchema(oldSchemaCode);
  const newSchema = parseZodSchema(newSchemaCode);

  const mocks = Array.from({ length: sampleCount }, (_, i) => generateMock(oldSchema, { seed: i }));

  const failureMap = new Map<string, FailureReason>();
  let invalidCount = 0;

  for (const mock of mocks) {
    const result = newSchema.safeParse(mock);
    if (!result.success) {
      invalidCount++;
      for (const issue of result.error.issues) {
        const fieldPath = issue.path.length > 0 ? issue.path.join('.') : 'root';
        const key = `${fieldPath}:${issue.code}`;
        const existing = failureMap.get(key);
        if (existing) {
          existing.affected_mock_count++;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyIssue = issue as any;
          failureMap.set(key, {
            field_path: fieldPath,
            zod_code: issue.code,
            expected: anyIssue.expected ?? issue.code,
            received: anyIssue.received ?? 'invalid',
            message: issue.message,
            affected_mock_count: 1,
          });
        }
      }
    }
  }

  return {
    breaking_change: invalidCount > 0,
    sample_count: sampleCount,
    invalid_mock_count: invalidCount,
    failure_reasons: Array.from(failureMap.values()).sort(
      (a, b) => b.affected_mock_count - a.affected_mock_count
    ),
  };
}

export async function evaluateSchemaEvolutionFromFile(
  schemaFilePath: string,
  schemaExportName: string,
  oldSchemaContent?: string
): Promise<EvaluateSchemaEvolutionResult> {
  const newFileContent = await readFile(schemaFilePath, 'utf-8');
  const newSchemaCode = extractZodCodeFromFile(newFileContent, schemaExportName);

  let oldSchemaCode: string;
  if (oldSchemaContent !== undefined) {
    oldSchemaCode = extractZodCodeFromFile(oldSchemaContent, schemaExportName);
  } else {
    const dir = path.dirname(schemaFilePath);
    const repoRoot = execSync('git rev-parse --show-toplevel', { cwd: dir }).toString().trim();
    // Resolve symlinks (/var → /private/var on macOS) before computing relative path
    const relPath = path.relative(realpathSync(repoRoot), realpathSync(schemaFilePath));
    const headContent = execSync(`git show HEAD:${relPath}`, { cwd: repoRoot }).toString();
    oldSchemaCode = extractZodCodeFromFile(headContent, schemaExportName);
  }

  return evaluateSchemaEvolution(oldSchemaCode, newSchemaCode);
}

const server = new McpServer({
  name: 'zod-contract-mock-forge-mcp',
  version: '0.1.0',
});

function errorResponse(err: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

server.registerTool(
  'introspect_schema',
  {
    description:
      'Convert a Zod schema string to JSON Schema for LLM understanding. ' +
      'Use to answer: what is the structure and constraints of this schema?',
    inputSchema: {
      schema_code: z.string().describe("Zod schema code (e.g., 'z.object({ name: z.string() })')"),
    },
  },
  async ({ schema_code }) => {
    try {
      const schema = parseZodSchema(schema_code);
      const jsonSchema = zodToJsonSchema(schema);
      return { content: [{ type: 'text', text: JSON.stringify(jsonSchema, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'read_schema_from_file',
  {
    description:
      'Read a Zod schema directly from a TypeScript or JavaScript file. ' +
      'Use to answer: what schema is defined in this file?',
    inputSchema: {
      file_path: z
        .string()
        .describe('Absolute path to the .ts or .js file containing the Zod schema'),
      export_name: z
        .string()
        .optional()
        .describe(
          'Name of the exported schema variable. If omitted, extracts the first Zod expression found.'
        ),
    },
  },
  async ({ file_path, export_name }) => {
    try {
      const content = await readFile(file_path, 'utf-8');

      let schemaCode = '';

      if (export_name) {
        const regex = new RegExp(
          `(?:export\\s+)?(?:const|let|var)\\s+${export_name}\\s*=\\s*([\\s\\S]*?)(?:;|$)`,
          'm'
        );
        const match = content.match(regex);
        if (match) {
          schemaCode = match[1].trim();
        } else {
          throw new Error(`Could not find export '${export_name}' in ${file_path}`);
        }
      } else {
        const zodRegex = /z\.(object|array|string|number|boolean|enum|record)\([\s\S]*?\)/m;
        const match = content.match(zodRegex);
        if (match) {
          schemaCode = match[0].trim();
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Could not automatically extract Zod schema from ${file_path}. Raw content:\n\n${content}`,
              },
            ],
          };
        }
      }

      return {
        content: [{ type: 'text', text: `Extracted schema from ${file_path}:\n\n${schemaCode}` }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'generate_valid_mock',
  {
    description:
      'Generate valid mock data from a Zod schema string. ' +
      'Use to answer: what does a valid payload for this schema look like?',
    inputSchema: {
      schema_code: z.string().describe('Zod schema code'),
      count: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe('Number of mocks to generate (default: 1)'),
    },
  },
  async ({ schema_code, count }) => {
    try {
      const schema = parseZodSchema(schema_code);
      const mocks = Array.from({ length: count }, () => generateMock(schema));
      return {
        content: [{ type: 'text', text: JSON.stringify(count === 1 ? mocks[0] : mocks, null, 2) }],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'generate_boundary_violations',
  {
    description:
      'Generate intentionally invalid payloads based on a Zod schema — for negative testing. ' +
      'Use to answer: what invalid inputs should I test against this API?',
    inputSchema: {
      schema_code: z.string().describe('Zod schema code'),
    },
  },
  async ({ schema_code }) => {
    try {
      const schema = parseZodSchema(schema_code);
      const violations = generateViolations(schema);
      return { content: [{ type: 'text', text: JSON.stringify(violations, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'generate_exhaustive_union_violations',
  {
    description:
      'Generate violation payloads for every branch of a z.union() or z.discriminatedUnion() schema. ' +
      'Use when generate_boundary_violations only covers one union variant and you need full branch coverage.',
    inputSchema: {
      schema_code: z
        .string()
        .describe('Zod schema code — must evaluate to a z.union() or z.discriminatedUnion()'),
    },
  },
  async ({ schema_code }) => {
    try {
      const schema = parseZodSchema(schema_code);
      const result = generateExhaustiveUnionViolations(schema);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'generate_mock_variants',
  {
    description:
      'Generate N structurally valid but value-diverse mocks from a Zod schema — for property-based testing. ' +
      'Use when generate_valid_mock is too deterministic and you need varied inputs to surface edge cases. ' +
      'Supply seed for reproducible output in CI.',
    inputSchema: {
      schema_code: z.string().describe('Zod schema code'),
      count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe('Number of mock variants to generate (default: 5, max: 50)'),
      seed: z
        .number()
        .int()
        .optional()
        .describe('Seed for reproducible output — omit for random variants each call'),
    },
  },
  async ({ schema_code, count, seed }) => {
    try {
      const schema = parseZodSchema(schema_code);
      const result = generateMockVariants(schema, schema_code, count, seed);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'scaffold_api_contract_test',
  {
    description:
      'Generate an API contract test or mock boilerplate for Playwright, Jest, Vitest, or MSW. ' +
      'Use to answer: how do I write a test that validates this API endpoint against this schema?',
    inputSchema: {
      framework: z
        .enum(['playwright', 'jest', 'vitest', 'msw'])
        .default('playwright')
        .describe('Testing framework to generate code for'),
      base_url: z.string().default('http://localhost:3000').describe('Base URL of the API'),
      endpoint: z.string().describe('API endpoint path (e.g., /api/users)'),
      method: z
        .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
        .default('GET')
        .describe('HTTP method'),
      schema_code: z.string().describe('Zod schema code for the response body'),
      test_name: z
        .string()
        .default('API Contract Validation')
        .describe('Name of the generated test'),
    },
  },
  async ({ framework, base_url, endpoint, method, schema_code, test_name }) => {
    try {
      let testCode = '';
      const url = `${base_url}${endpoint}`;

      if (framework === 'playwright') {
        testCode = `import { test, expect } from '@playwright/test';
import { z } from 'zod';

const schema = ${schema_code};

test('${test_name}', async ({ request }) => {
  const response = await request.${method.toLowerCase()}('${url}');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    console.error('Contract violation:', result.error.format());
  }
  expect(result.success).toBe(true);
});`;
      } else if (framework === 'jest' || framework === 'vitest') {
        const imp = framework === 'vitest' ? `import { test, expect } from 'vitest';\n` : '';
        testCode = `${imp}import { z } from 'zod';
import axios from 'axios';

const schema = ${schema_code};

test('${test_name}', async () => {
  const response = await axios.${method.toLowerCase()}('${url}');
  const result = schema.safeParse(response.data);
  if (!result.success) {
    console.error('Contract violation:', result.error.format());
  }
  expect(result.success).toBe(true);
});`;
      } else if (framework === 'msw') {
        testCode = `import { http, HttpResponse } from 'msw';
import { z } from 'zod';

const schema = ${schema_code};

export const handlers = [
  http.${method.toLowerCase()}('${url}', () => {
    // Use generate_valid_mock to get a valid payload
    return HttpResponse.json({ /* mock data */ });
  }),
];`;
      }

      return { content: [{ type: 'text', text: testCode }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'suggest_contract_fix',
  {
    description:
      'Validate a JSON payload against a Zod schema and suggest fixes for each violation. ' +
      'Use to answer: why does this payload fail validation, and how do I fix it?',
    inputSchema: {
      schema_code: z.string().describe('Zod schema code'),
      payload: z.string().describe('JSON string of the failing payload'),
    },
  },
  async ({ schema_code, payload }) => {
    try {
      const schema = parseZodSchema(schema_code);
      let payloadObj: unknown;
      try {
        payloadObj = JSON.parse(payload);
      } catch {
        throw new Error('payload must be valid JSON');
      }

      const result = schema.safeParse(payloadObj);
      if (result.success) {
        return {
          content: [
            { type: 'text', text: 'The payload is valid against the schema. No fixes needed.' },
          ],
        };
      }

      const lines: string[] = ['Contract Violation Detected.', ''];
      result.error.issues.forEach((issue, index) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        lines.push(`Issue ${index + 1}: At '${path}', ${issue.message}`);
        lines.push(`  -> To fix data: Provide a valid value for '${path}'.`);

        let schemaFix = `Make '${path}' optional(), nullable(), or change its type.`;
        if (issue.code === 'invalid_type' && issue.received === 'undefined') {
          schemaFix = `Make '${path}' optional: z...optional()`;
        } else if (issue.code === 'invalid_type' && issue.received === 'null') {
          schemaFix = `Make '${path}' nullable: z...nullable()`;
        } else if (issue.code === 'invalid_type') {
          schemaFix = `Change the type of '${path}' to match received type (${issue.received}).`;
        }

        lines.push(`  -> To fix schema: ${schemaFix}`);
        lines.push('');
      });

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'detect_schema_drift',
  {
    description:
      'Compare a Zod schema in a TypeScript file against an OpenAPI spec — finds silent divergence. ' +
      'Use when Zod and OpenAPI docs are maintained separately and may have drifted apart. ' +
      'Reports missing fields, extra fields, type conflicts, and required/optional mismatches.',
    inputSchema: {
      zod_file_path: z
        .string()
        .describe('Absolute path to the .ts or .js file containing the Zod schema'),
      schema_export_name: z
        .string()
        .describe('Name of the exported Zod schema variable (e.g. "UserSchema")'),
      openapi_file_path: z
        .string()
        .describe('Absolute path to the OpenAPI spec (.yaml, .yml, or .json)'),
      openapi_schema_name: z
        .string()
        .optional()
        .describe(
          'Schema name in components.schemas to compare against. Defaults to schema_export_name.'
        ),
    },
  },
  async ({ zod_file_path, schema_export_name, openapi_file_path, openapi_schema_name }) => {
    try {
      const result = await detectSchemaDrift(
        zod_file_path,
        openapi_file_path,
        schema_export_name,
        openapi_schema_name
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

server.registerTool(
  'evaluate_schema_evolution',
  {
    description:
      'Detect breaking changes when a Zod schema is tightened — before tests run. ' +
      'Generates mocks from the old schema, validates them against the new schema, ' +
      'and reports exactly which fields and constraints now reject previously valid data. ' +
      'Use when you changed a schema and want to know if existing test fixtures will break.',
    inputSchema: {
      schema_file_path: z
        .string()
        .describe('Absolute path to the TypeScript file containing the updated Zod schema'),
      schema_export_name: z.string().describe('Name of the exported Zod schema variable'),
      old_schema_content: z
        .string()
        .optional()
        .describe(
          'Full content of the old schema file. ' +
            'Omit to automatically retrieve the last committed version via git show HEAD.'
        ),
    },
  },
  async ({ schema_file_path, schema_export_name, old_schema_content }) => {
    try {
      const result = await evaluateSchemaEvolutionFromFile(
        schema_file_path,
        schema_export_name,
        old_schema_content
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return errorResponse(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
