import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseZodSchema, generateViolations, generateExhaustiveUnionViolations } from './index.js';

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
});
