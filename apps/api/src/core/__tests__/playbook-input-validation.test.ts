import { describe, it, expect } from 'vitest'
import { applyInputDefaults, validateInput, InputValidationError } from '../playbook-executor.js'

// ── Shared test schema ──────────────────────────────────────────────

const schema = {
  properties: {
    name: { type: 'string' },
    count: { type: 'number' },
    enabled: { type: 'boolean' },
    tag: { type: 'string', default: 'default-tag' },
    optional_str: { type: 'string' },
    optional_num: { type: 'number' },
    optional_bool: { type: 'boolean' },
  },
  required: ['name', 'count', 'enabled'],
}

// ── applyInputDefaults ──────────────────────────────────────────────

describe('applyInputDefaults', () => {
  it('assigns "" for optional string field without default', () => {
    const result = applyInputDefaults({}, schema)
    expect(result.optional_str).toBe('')
  })

  it('assigns 0 for optional number field without default', () => {
    const result = applyInputDefaults({}, schema)
    expect(result.optional_num).toBe(0)
  })

  it('assigns false for optional boolean field without default', () => {
    const result = applyInputDefaults({}, schema)
    expect(result.optional_bool).toBe(false)
  })

  it('uses explicit default when provided', () => {
    const result = applyInputDefaults({}, schema)
    expect(result.tag).toBe('default-tag')
  })

  it('does not overwrite existing input values', () => {
    const result = applyInputDefaults({ tag: 'custom', optional_num: 42 }, schema)
    expect(result.tag).toBe('custom')
    expect(result.optional_num).toBe(42)
  })

  it('does not assign zero-values for required fields without defaults', () => {
    const result = applyInputDefaults({}, schema)
    expect(result.name).toBeUndefined()
    expect(result.count).toBeUndefined()
    expect(result.enabled).toBeUndefined()
  })

  it('returns input unchanged when schema has no properties', () => {
    const input = { foo: 'bar' }
    const result = applyInputDefaults(input, {})
    expect(result).toEqual({ foo: 'bar' })
  })
})

// ── validateInput — required field presence ─────────────────────────

describe('validateInput', () => {
  describe('required field presence', () => {
    it('passes when all required fields are present with correct types', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: true }, schema),
      ).not.toThrow()
    })

    it('throws InputValidationError for undefined required field', () => {
      expect(() =>
        validateInput({ name: 'test', enabled: true }, schema),
      ).toThrow(InputValidationError)
    })

    it('throws InputValidationError for null required field', () => {
      expect(() =>
        validateInput({ name: 'test', count: null, enabled: true }, schema),
      ).toThrow(InputValidationError)
    })

    it('error .fields contains correct field names', () => {
      try {
        validateInput({}, schema)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(InputValidationError)
        const ve = err as InputValidationError
        expect(ve.fields).toContain('name')
        expect(ve.fields).toContain('count')
        expect(ve.fields).toContain('enabled')
      }
    })
  })

  // ── Bug #72: empty string on non-string required fields ───────────

  describe('empty string on non-string fields (Bug #72)', () => {
    it('throws for "" on required number field', () => {
      expect(() =>
        validateInput({ name: 'test', count: '', enabled: true }, schema),
      ).toThrow(InputValidationError)
    })

    it('throws for "" on required boolean field', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: '' }, schema),
      ).toThrow(InputValidationError)
    })

    it('passes for "" on required string field', () => {
      expect(() =>
        validateInput({ name: '', count: 5, enabled: true }, schema),
      ).not.toThrow()
    })
  })

  // ── Falsy-but-valid values ────────────────────────────────────────

  describe('falsy-but-valid values', () => {
    it('passes for 0 on required number field', () => {
      expect(() =>
        validateInput({ name: 'test', count: 0, enabled: true }, schema),
      ).not.toThrow()
    })

    it('passes for false on required boolean field', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: false }, schema),
      ).not.toThrow()
    })
  })

  // ── Type checking ─────────────────────────────────────────────────

  describe('type checking', () => {
    it('throws for string value in number field', () => {
      expect(() =>
        validateInput({ name: 'test', count: 'not-a-number', enabled: true }, schema),
      ).toThrow(InputValidationError)
    })

    it('throws for number value in boolean field', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: 1 }, schema),
      ).toThrow(InputValidationError)
    })

    it('passes when all types match', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: true, optional_str: 'hi', optional_num: 3 }, schema),
      ).not.toThrow()
    })

    it('skips type check on undefined/null optional fields', () => {
      expect(() =>
        validateInput({ name: 'test', count: 5, enabled: true, optional_num: undefined }, schema),
      ).not.toThrow()
    })
  })

  // ── Integration: defaults + validate ──────────────────────────────

  describe('applyInputDefaults + validateInput integration', () => {
    it('defaults fill optional fields so validation passes', () => {
      const input = applyInputDefaults({ name: 'test', count: 5, enabled: true }, schema)
      expect(() => validateInput(input, schema)).not.toThrow()
      // Optional fields should have their zero-values
      expect(input.optional_str).toBe('')
      expect(input.optional_num).toBe(0)
      expect(input.optional_bool).toBe(false)
      expect(input.tag).toBe('default-tag')
    })
  })
})
