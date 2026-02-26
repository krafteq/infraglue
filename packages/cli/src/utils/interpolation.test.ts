import { interpolateString, interpolateConfig } from './interpolation.js'
import { UserError } from './errors.js'

describe('interpolateString', () => {
  const env = { HOME: '/home/user', REGION: 'us-east-1', EMPTY: '' }

  it('should return plain strings unchanged', () => {
    expect(interpolateString('hello world', env)).toBe('hello world')
  })

  it('should substitute a single variable', () => {
    expect(interpolateString('${REGION}', env)).toBe('us-east-1')
  })

  it('should substitute multiple variables', () => {
    expect(interpolateString('${HOME}/config/${REGION}', env)).toBe('/home/user/config/us-east-1')
  })

  it('should substitute variable with surrounding text', () => {
    expect(interpolateString('prefix-${REGION}-suffix', env)).toBe('prefix-us-east-1-suffix')
  })

  it('should allow empty string env var', () => {
    expect(interpolateString('val=${EMPTY}!', env)).toBe('val=!')
  })

  it('should throw UserError for missing variable', () => {
    expect(() => interpolateString('${MISSING}', env)).toThrow(UserError)
    expect(() => interpolateString('${MISSING}', env)).toThrow("Environment variable 'MISSING' is not set")
  })

  it('should include context in error message', () => {
    expect(() => interpolateString('${MISSING}', env, 'root ig.yaml vars')).toThrow(
      "Environment variable 'MISSING' is not set (in root ig.yaml vars)",
    )
  })

  it('should escape $${VAR} to literal ${VAR}', () => {
    expect(interpolateString('$${REGION}', env)).toBe('${REGION}')
  })

  it('should handle escape and real interpolation together', () => {
    expect(interpolateString('$${LITERAL} and ${REGION}', env)).toBe('${LITERAL} and us-east-1')
  })

  it('should pass through $ not followed by { or ${', () => {
    expect(interpolateString('$100', env)).toBe('$100')
  })

  it('should pass through ${...without closing brace', () => {
    expect(interpolateString('${UNCLOSED', env)).toBe('${UNCLOSED')
  })

  it('should handle empty string input', () => {
    expect(interpolateString('', env)).toBe('')
  })
})

describe('interpolateConfig', () => {
  const env = { BUCKET: 'my-bucket', KEY: 'state.tfstate', REGION: 'us-east-1' }

  it('should interpolate a plain string', () => {
    expect(interpolateConfig('${BUCKET}', env)).toBe('my-bucket')
  })

  it('should interpolate values in a record', () => {
    const input = { bucket: '${BUCKET}', key: '${KEY}' }
    expect(interpolateConfig(input, env)).toEqual({ bucket: 'my-bucket', key: 'state.tfstate' })
  })

  it('should interpolate strings in an array', () => {
    const input = ['./envs/${REGION}.tfvars', 'static.tfvars']
    expect(interpolateConfig(input, env)).toEqual(['./envs/us-east-1.tfvars', 'static.tfvars'])
  })

  it('should pass through non-string values unchanged', () => {
    expect(interpolateConfig(42, env)).toBe(42)
    expect(interpolateConfig(true, env)).toBe(true)
    expect(interpolateConfig(null, env)).toBeNull()
    expect(interpolateConfig(undefined, env)).toBeUndefined()
  })

  it('should recursively interpolate nested objects', () => {
    const input = {
      backend: { bucket: '${BUCKET}', key: '${KEY}' },
      vars: { region: '${REGION}' },
    }
    expect(interpolateConfig(input, env)).toEqual({
      backend: { bucket: 'my-bucket', key: 'state.tfstate' },
      vars: { region: 'us-east-1' },
    })
  })

  it('should propagate context in errors', () => {
    expect(() => interpolateConfig('${MISSING}', env, 'test context')).toThrow(
      "Environment variable 'MISSING' is not set (in test context)",
    )
  })
})
