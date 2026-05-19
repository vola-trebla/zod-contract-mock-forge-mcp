import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseZodSchema,
  generateViolations,
  generateExhaustiveUnionViolations,
  generateMockVariants,
  detectSchemaDrift,
} from './index.js';

describe('Forge Core Logic', () => {
  describe('parseZodSchema', () => {
    it('should parse a simple object schema', () => {
      const code = 'z.object({ name: z.string() })';
      const schema = parseZodSchema(code);
      expect(schema).toBeInstanceOf(z.ZodObject);
      expect((schema as z.ZodObject<any>).shape.name).toBeInstanceOf(z.ZodString);
    });

    it('should handle code with imports and const', () => {
      const code = "import { z } from 'zod'; const schema = z.string().email();";
      const schema = parseZodSchema(code);
      expect(schema).toBeInstanceOf(z.ZodString);
    });

    it('should throw on invalid schema code', () => {
      const code = 'not-a-schema';
      expect(() => parseZodSchema(code)).toThrow();
    });
  });

  describe('generateViolations', () => {
    it('should generate deep violations for nested objects', () => {
      const schema = z.object({
        user: z.object({
          age: z.number().min(18),
        }),
      });
      const violations = generateViolations(schema);

      const ageViolation = violations.find(
        (v) => v.description.includes('user.age') && v.type === 'MIN_VALUE_VIOLATION'
      );
      expect(ageViolation).toBeDefined();
      expect((ageViolation?.payload as any).user.age).toBeLessThan(18);
    });

    it('should generate violations for required fields', () => {
      const schema = z.object({
        name: z.string(),
        email: z.string().email(),
      });
      const violations = generateViolations(schema);

      const nameViolation = violations.find(
        (v) => v.type === 'MISSING_REQUIRED_FIELD' && v.description.includes('name')
      );
      expect(nameViolation).toBeDefined();
      expect((nameViolation?.payload as any).name).toBeUndefined();
    });
  });

  describe('generateExhaustiveUnionViolations', () => {
    it('covers every variant of a discriminated union', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('cat'), lives: z.number() }),
        z.object({ type: z.literal('dog'), breed: z.string() }),
        z.object({ type: z.literal('bird'), canFly: z.boolean() }),
      ]);
      const result = generateExhaustiveUnionViolations(schema);

      expect(result.union_type).toBe('discriminated');
      expect(result.discriminator_key).toBe('type');
      expect(result.total_variants).toBe(3);
      expect(result.violations).toHaveLength(3);
    });

    it('generates missing_discriminator violation for each variant', () => {
      const schema = z.discriminatedUnion('status', [
        z.object({ status: z.literal('active'), name: z.string() }),
        z.object({ status: z.literal('inactive'), code: z.number() }),
      ]);
      const result = generateExhaustiveUnionViolations(schema);

      for (const v of result.violations) {
        const missing = v.payloads.find((p) => p.violation_type === 'missing_discriminator');
        expect(missing).toBeDefined();
        expect((missing!.payload as any).status).toBeUndefined();
      }
    });

    it('generates wrong_discriminator_value violation for each variant', () => {
      const schema = z.discriminatedUnion('status', [
        z.object({ status: z.literal('active'), name: z.string() }),
        z.object({ status: z.literal('inactive'), code: z.number() }),
      ]);
      const result = generateExhaustiveUnionViolations(schema);

      for (const v of result.violations) {
        const wrong = v.payloads.find((p) => p.violation_type === 'wrong_discriminator_value');
        expect(wrong).toBeDefined();
        expect((wrong!.payload as any).status).toBe('__invalid__');
      }
    });

    it('generates required_field_type_mismatch for non-discriminator fields', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('cat'), lives: z.number() }),
      ]);
      const result = generateExhaustiveUnionViolations(schema);

      const mismatch = result.violations[0].payloads.find(
        (p) => p.violation_type === 'required_field_type_mismatch'
      );
      expect(mismatch).toBeDefined();
      expect(typeof (mismatch!.payload as any).lives).toBe('string');
    });

    it('covers every variant of a plain union', () => {
      const schema = z.union([
        z.object({ kind: z.literal('a'), value: z.string() }),
        z.object({ kind: z.literal('b'), count: z.number() }),
      ]);
      const result = generateExhaustiveUnionViolations(schema);

      expect(result.union_type).toBe('plain');
      expect(result.total_variants).toBe(2);
      expect(result.violations).toHaveLength(2);
    });

    it('generates missing_required_field for plain union variants', () => {
      const schema = z.union([z.object({ name: z.string() }), z.object({ age: z.number() })]);
      const result = generateExhaustiveUnionViolations(schema);

      const firstVariant = result.violations[0];
      const missing = firstVariant.payloads.find(
        (p) => p.violation_type === 'missing_required_field'
      );
      expect(missing).toBeDefined();
      expect((missing!.payload as any).name).toBeUndefined();
    });

    it('throws for non-union schemas', () => {
      const schema = z.object({ name: z.string() });
      expect(() => generateExhaustiveUnionViolations(schema)).toThrow();
    });
  });

  describe('generateMockVariants', () => {
    const schema = z.object({ name: z.string(), age: z.number().min(0).max(120) });
    const code = 'z.object({ name: z.string(), age: z.number().min(0).max(120) })';

    it('returns the requested count of variants', () => {
      const result = generateMockVariants(schema, code, 5);
      expect(result.count).toBe(5);
      expect(result.variants).toHaveLength(5);
    });

    it('all variants pass schema validation', () => {
      const result = generateMockVariants(schema, code, 10);
      expect(result.all_valid).toBe(true);
    });

    it('produces a stable schema_id from schema code', () => {
      const r1 = generateMockVariants(schema, code, 1);
      const r2 = generateMockVariants(schema, code, 3);
      expect(r1.schema_id).toBe(r2.schema_id);
      expect(r1.schema_id).toMatch(/^schema_[0-9a-f]{8}$/);
    });

    it('returns deterministic output for the same seed', () => {
      const r1 = generateMockVariants(schema, code, 5, 42);
      const r2 = generateMockVariants(schema, code, 5, 42);
      expect(r1.variants).toEqual(r2.variants);
    });

    it('returns different output for different seeds', () => {
      const r1 = generateMockVariants(schema, code, 5, 1);
      const r2 = generateMockVariants(schema, code, 5, 2);
      expect(r1.variants).not.toEqual(r2.variants);
    });

    it('works without a seed', () => {
      const result = generateMockVariants(schema, code, 3);
      expect(result.variants).toHaveLength(3);
      expect(result.all_valid).toBe(true);
    });
  });

  describe('detectSchemaDrift', () => {
    let testDir: string;
    let zodFile: string;
    let openApiFile: string;
    let driftedOpenApiFile: string;

    beforeAll(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));

      zodFile = path.join(testDir, 'schemas.ts');
      fs.writeFileSync(
        zodFile,
        [
          'export const UserSchema = z.object({',
          '  name: z.string(),',
          '  age: z.number(),',
          '  email: z.string().email(),',
          '});',
        ].join('\n')
      );

      // OpenAPI spec in sync with Zod
      openApiFile = path.join(testDir, 'openapi.yaml');
      fs.writeFileSync(
        openApiFile,
        [
          'openapi: "3.0.0"',
          'components:',
          '  schemas:',
          '    UserSchema:',
          '      type: object',
          '      required: [name, age, email]',
          '      properties:',
          '        name:',
          '          type: string',
          '        age:',
          '          type: number',
          '        email:',
          '          type: string',
        ].join('\n')
      );

      // OpenAPI spec with drift: missing email, extra role, age as string
      driftedOpenApiFile = path.join(testDir, 'openapi-drifted.yaml');
      fs.writeFileSync(
        driftedOpenApiFile,
        [
          'openapi: "3.0.0"',
          'components:',
          '  schemas:',
          '    UserSchema:',
          '      type: object',
          '      required: [name, role]',
          '      properties:',
          '        name:',
          '          type: string',
          '        age:',
          '          type: string',
          '        role:',
          '          type: string',
        ].join('\n')
      );
    });

    afterAll(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('returns zero drifts when schemas are in sync', async () => {
      const result = await detectSchemaDrift(zodFile, openApiFile, 'UserSchema');
      expect(result.drift_count).toBe(0);
      expect(result.drifts).toHaveLength(0);
    });

    it('detects field missing in OpenAPI (email)', async () => {
      const result = await detectSchemaDrift(zodFile, driftedOpenApiFile, 'UserSchema');
      const missing = result.drifts.find(
        (d) => d.drift_type === 'missing_in_openapi' && d.field_path === 'email'
      );
      expect(missing).toBeDefined();
    });

    it('detects field missing in Zod (role)', async () => {
      const result = await detectSchemaDrift(zodFile, driftedOpenApiFile, 'UserSchema');
      const extra = result.drifts.find(
        (d) => d.drift_type === 'missing_in_zod' && d.field_path === 'role'
      );
      expect(extra).toBeDefined();
    });

    it('detects type conflict (age: number vs string)', async () => {
      const result = await detectSchemaDrift(zodFile, driftedOpenApiFile, 'UserSchema');
      const conflict = result.drifts.find(
        (d) => d.drift_type === 'type_conflict' && d.field_path === 'age'
      );
      expect(conflict).toBeDefined();
      expect(conflict!.zod_value).toBe('number');
      expect(conflict!.openapi_value).toBe('string');
    });

    it('detects required mismatch', async () => {
      const result = await detectSchemaDrift(zodFile, driftedOpenApiFile, 'UserSchema');
      const mismatch = result.drifts.find(
        (d) => d.drift_type === 'required_mismatch' && d.field_path === 'age'
      );
      expect(mismatch).toBeDefined();
    });

    it('throws when schema name not found in OpenAPI', async () => {
      await expect(
        detectSchemaDrift(zodFile, openApiFile, 'UserSchema', 'NonExistentSchema')
      ).rejects.toThrow('NonExistentSchema');
    });

    it('includes schema names in result', async () => {
      const result = await detectSchemaDrift(zodFile, openApiFile, 'UserSchema');
      expect(result.zod_schema_name).toBe('UserSchema');
      expect(result.openapi_schema_name).toBe('UserSchema');
    });
  });
});
