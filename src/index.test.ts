import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseZodSchema, generateViolations } from './index.js';

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
});
