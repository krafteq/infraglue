import { VaultClient } from './vault-client.js'
import { UserError } from './errors.js'
import { readFile } from 'fs/promises'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

const mockedReadFile = vi.mocked(readFile)

const VAULT_ADDR = 'https://vault.example.com'

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

function kvResponse(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ data: { data } }), { status: 200 })
}

function errorResponse(status: number, body = '') {
  return new Response(body, { status })
}

describe('VaultClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('token resolution', () => {
    it('should use VAULT_TOKEN env var first', async () => {
      mockFetch(() => kvResponse({ password: 'secret123' }))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'my-token' } })

      const result = await client.getSecret('secret/data/app', 'password')

      expect(result).toBe('secret123')
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `${VAULT_ADDR}/v1/secret/data/app`,
        expect.objectContaining({ headers: { 'X-Vault-Token': 'my-token' } }),
      )
    })

    it('should fall back to ~/.vault-token file', async () => {
      mockedReadFile.mockResolvedValue('file-token\n')
      mockFetch(() => kvResponse({ key: 'value' }))
      const client = new VaultClient(VAULT_ADDR, { env: {} })

      await client.getSecret('secret/data/app', 'key')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: { 'X-Vault-Token': 'file-token' } }),
      )
    })

    it('should fall back to JWT auth when VAULT_ID_TOKEN is set', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      mockFetch((url, init) => {
        if (url.includes('/auth/jwt/login')) {
          const body = JSON.parse(init?.body as string)
          expect(body.role).toBe('my-role')
          expect(body.jwt).toBe('my-jwt')
          return new Response(JSON.stringify({ auth: { client_token: 'jwt-token' } }), { status: 200 })
        }
        return kvResponse({ secret: 'from-jwt' })
      })
      const client = new VaultClient(VAULT_ADDR, {
        role: 'my-role',
        env: { VAULT_ID_TOKEN: 'my-jwt' },
      })

      const result = await client.getSecret('secret/data/app', 'secret')

      expect(result).toBe('from-jwt')
    })

    it('should use VAULT_ROLE env var for JWT auth', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      mockFetch((url) => {
        if (url.includes('/auth/jwt/login')) {
          return new Response(JSON.stringify({ auth: { client_token: 'tok' } }), { status: 200 })
        }
        return kvResponse({ k: 'v' })
      })
      const client = new VaultClient(VAULT_ADDR, {
        env: { VAULT_ID_TOKEN: 'jwt', VAULT_ROLE: 'env-role' },
      })

      await client.getSecret('secret/data/app', 'k')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/auth/jwt/login'),
        expect.objectContaining({
          body: JSON.stringify({ role: 'env-role', jwt: 'jwt' }),
        }),
      )
    })

    it('should use custom VAULT_AUTH_MOUNT', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      mockFetch((url) => {
        if (url.includes('/auth/custom-mount/login')) {
          return new Response(JSON.stringify({ auth: { client_token: 'tok' } }), { status: 200 })
        }
        return kvResponse({ k: 'v' })
      })
      const client = new VaultClient(VAULT_ADDR, {
        role: 'r',
        env: { VAULT_ID_TOKEN: 'jwt', VAULT_AUTH_MOUNT: 'custom-mount' },
      })

      await client.getSecret('secret/data/app', 'k')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(`${VAULT_ADDR}/v1/auth/custom-mount/login`, expect.any(Object))
    })

    it('should throw when no auth method is available', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      const client = new VaultClient(VAULT_ADDR, { env: {} })

      await expect(client.getSecret('secret/data/app', 'key')).rejects.toThrow(UserError)
      await expect(client.getSecret('secret/data/app', 'key')).rejects.toThrow('no token found')
    })

    it('should throw when JWT auth has no role', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_ID_TOKEN: 'jwt' } })

      await expect(client.getSecret('secret/data/app', 'key')).rejects.toThrow('JWT auth requires a role')
    })

    it('should resolve token only once across multiple calls', async () => {
      mockedReadFile.mockResolvedValue('token')
      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return kvResponse({ k: 'v' })
      })
      const client = new VaultClient(VAULT_ADDR, { env: {} })

      await Promise.all([client.getSecret('secret/data/a', 'k'), client.getSecret('secret/data/b', 'k')])

      expect(mockedReadFile).toHaveBeenCalledTimes(1)
      expect(fetchCount).toBe(2) // two different paths
    })
  })

  describe('secret fetching', () => {
    it('should cache secrets by path', async () => {
      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return kvResponse({ field1: 'a', field2: 'b' })
      })
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      const r1 = await client.getSecret('secret/data/app', 'field1')
      const r2 = await client.getSecret('secret/data/app', 'field2')

      expect(r1).toBe('a')
      expect(r2).toBe('b')
      expect(fetchCount).toBe(1)
    })

    it('should throw on missing field', async () => {
      mockFetch(() => kvResponse({ exists: 'yes' }))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'missing')).rejects.toThrow("does not contain field 'missing'")
    })

    it('should throw on non-string field value', async () => {
      mockFetch(() => kvResponse({ nested: { deep: true } }))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'nested')).rejects.toThrow('is not a string')
    })

    it('should throw on 403', async () => {
      mockFetch(() => errorResponse(403))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('access denied')
    })

    it('should throw on 404', async () => {
      mockFetch(() => errorResponse(404))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('not found')
    })

    it('should throw on unexpected HTTP status', async () => {
      mockFetch(() => errorResponse(500))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('HTTP 500')
    })

    it('should throw on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('Cannot connect to Vault')
    })

    it('should throw on unexpected response format', async () => {
      mockFetch(() => new Response(JSON.stringify({ data: {} }), { status: 200 }))
      const client = new VaultClient(VAULT_ADDR, { env: { VAULT_TOKEN: 'tok' } })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('unexpected format')
    })

    it('should strip trailing slash from address', async () => {
      mockFetch(() => kvResponse({ k: 'v' }))
      const client = new VaultClient('https://vault.example.com/', { env: { VAULT_TOKEN: 'tok' } })

      await client.getSecret('secret/data/app', 'k')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith('https://vault.example.com/v1/secret/data/app', expect.any(Object))
    })
  })

  describe('JWT auth failure', () => {
    it('should throw on JWT auth HTTP error', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      mockFetch(() => errorResponse(400, 'invalid jwt'))
      const client = new VaultClient(VAULT_ADDR, {
        role: 'r',
        env: { VAULT_ID_TOKEN: 'bad-jwt' },
      })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('JWT authentication failed')
    })

    it('should throw on JWT auth missing client_token', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'))
      mockFetch(() => new Response(JSON.stringify({ auth: {} }), { status: 200 }))
      const client = new VaultClient(VAULT_ADDR, {
        role: 'r',
        env: { VAULT_ID_TOKEN: 'jwt' },
      })

      await expect(client.getSecret('secret/data/app', 'k')).rejects.toThrow('missing client_token')
    })
  })
})
