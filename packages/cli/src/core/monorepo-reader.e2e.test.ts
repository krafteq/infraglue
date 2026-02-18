import { resolve, join } from 'path'
import { tryReadMonorepo, tryResolveMonorepo } from './monorepo-reader.js'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'

const FIXTURES_DIR = resolve(import.meta.dirname, '__fixtures__')

describe('tryReadMonorepo', () => {
  describe('simple-chain fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'simple-chain')

    it('should parse 3 workspaces', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo).not.toBeNull()
      expect(monorepo!.workspaces).toHaveLength(3)
    })

    it('should resolve workspace names as relative paths', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const names = monorepo!.workspaces.map((w) => w.name)
      expect(names).toContain('ws-a')
      expect(names).toContain('ws-b')
      expect(names).toContain('ws-c')
    })

    it('should resolve injection dependencies', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const wsB = monorepo!.workspaces.find((w) => w.name === 'ws-b')!
      expect(wsB.injections).toHaveProperty('out1')
      expect(wsB.injections.out1.key).toBe('out1')
      // injection workspace resolved to absolute path
      expect(wsB.injections.out1.workspace).toBe(join(fixturePath, 'ws-a'))
    })

    it('should resolve depends_on to absolute paths', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const wsC = monorepo!.workspaces.find((w) => w.name === 'ws-c')!
      expect(wsC.dependsOn).toEqual([join(fixturePath, 'ws-b')])
    })

    it('should calculate allDependsOn including injection sources', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const wsB = monorepo!.workspaces.find((w) => w.name === 'ws-b')!
      expect(wsB.allDependsOn).toContain(join(fixturePath, 'ws-a'))
    })

    it('should detect terraform provider', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      for (const ws of monorepo!.workspaces) {
        expect(ws.providerName).toBe('terraform')
      }
    })

    it('should set monorepo path', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo!.path).toBe(fixturePath)
    })
  })

  describe('cross-provider fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'cross-provider')

    it('should parse mixed provider workspaces', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo).not.toBeNull()
      expect(monorepo!.workspaces).toHaveLength(2)

      const network = monorepo!.workspaces.find((w) => w.name === 'network')!
      const database = monorepo!.workspaces.find((w) => w.name === 'database')!

      expect(network.providerName).toBe('pulumi')
      expect(database.providerName).toBe('terraform')
    })

    it('should wire cross-provider injection', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const database = monorepo!.workspaces.find((w) => w.name === 'database')!
      expect(database.injections.network_name.workspace).toBe(join(fixturePath, 'network'))
      expect(database.injections.network_name.key).toBe('network_name')
    })

    it('should parse monorepo exports', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo!.exports).toHaveLength(2)
      expect(monorepo!.exports).toContainEqual({
        name: 'network_name',
        workspace: join(fixturePath, 'network'),
        key: 'network_name',
      })
      expect(monorepo!.exports).toContainEqual({
        name: 'db_host',
        workspace: join(fixturePath, 'database'),
        key: 'db_host',
      })
    })
  })

  describe('diamond-dependency fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'diamond-dependency')

    it('should parse 4 workspaces', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo!.workspaces).toHaveLength(4)
    })

    it('should resolve diamond depends_on', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const wsD = monorepo!.workspaces.find((w) => w.name === 'ws-d')!
      expect(wsD.dependsOn).toHaveLength(2)
      expect(wsD.dependsOn).toContain(join(fixturePath, 'ws-b'))
      expect(wsD.dependsOn).toContain(join(fixturePath, 'ws-c'))
    })
  })

  describe('multi-env fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'multi-env')

    it('should parse all environment configs', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const service = monorepo!.workspaces.find((w) => w.name === 'service')!
      expect(Object.keys(service.envs)).toEqual(['dev', 'qa', 'prod'])
    })

    it('should preserve env vars', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const service = monorepo!.workspaces.find((w) => w.name === 'service')!
      // YAML parser returns numbers for numeric values; monorepo-reader passes raw config through
      expect(service.envs.dev.vars).toEqual({ instance_count: 1, port: 3000 })
    })

    it('should preserve backend_type and backend_config', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const service = monorepo!.workspaces.find((w) => w.name === 'service')!
      expect(service.envs.prod.backend_type).toBe('s3')
      expect(service.envs.prod.backend_config).toEqual({
        bucket: 'my-terraform-state',
        key: 'prod/terraform.tfstate',
      })
    })

    it('should preserve var_files', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const service = monorepo!.workspaces.find((w) => w.name === 'service')!
      expect(service.envs.dev.var_files).toEqual(['./envs/dev.tfvars'])
    })

    it('should report correct hasEnv', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const service = monorepo!.workspaces.find((w) => w.name === 'service')!
      expect(service.hasEnv('dev')).toBe(true)
      expect(service.hasEnv('qa')).toBe(true)
      expect(service.hasEnv('prod')).toBe(true)
      expect(service.hasEnv('staging')).toBe(false)
    })
  })

  describe('injection-only fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'injection-only')

    it('should infer dependency from injection alone', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const consumer = monorepo!.workspaces.find((w) => w.name === 'consumer')!
      // No explicit depends_on, but injection creates an implicit dependency
      expect(consumer.dependsOn).toEqual([])
      expect(consumer.allDependsOn).toContain(join(fixturePath, 'producer'))
    })

    it('should have no explicit depends_on on consumer', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      const consumer = monorepo!.workspaces.find((w) => w.name === 'consumer')!
      expect(consumer.dependsOn).toHaveLength(0)
    })
  })

  describe('no-config-workspace fixture', () => {
    const fixturePath = join(FIXTURES_DIR, 'no-config-workspace')

    it('should auto-detect terraform provider from .tf files', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo).not.toBeNull()
      expect(monorepo!.workspaces).toHaveLength(1)
      expect(monorepo!.workspaces[0].providerName).toBe('terraform')
    })

    it('should use relative path as name when no alias', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo!.workspaces[0].name).toBe('auto-detected')
    })

    it('should have empty envs for no-config workspace', async () => {
      const monorepo = await tryReadMonorepo(fixturePath)
      expect(monorepo!.workspaces[0].envs).toEqual({})
    })
  })

  describe('edge cases', () => {
    it('should return null for directory with no ig.yaml', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'no-config-'))
      try {
        const result = await tryReadMonorepo(tmpDir)
        expect(result).toBeNull()
      } finally {
        await rm(tmpDir, { recursive: true })
      }
    })

    it('should return null for directory with non-monorepo ig.yaml', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'ws-only-'))
      try {
        await writeFile(join(tmpDir, 'ig.yaml'), 'provider: terraform\n')
        const result = await tryReadMonorepo(tmpDir)
        expect(result).toBeNull()
      } finally {
        await rm(tmpDir, { recursive: true })
      }
    })
  })
})

describe('tryResolveMonorepo', () => {
  it('should resolve from root directory', async () => {
    const fixturePath = join(FIXTURES_DIR, 'simple-chain')
    const monorepo = await tryResolveMonorepo(fixturePath)
    expect(monorepo).not.toBeNull()
    expect(monorepo!.path).toBe(fixturePath)
  })

  it('should resolve from workspace subdirectory', async () => {
    const fixturePath = join(FIXTURES_DIR, 'simple-chain')
    const monorepo = await tryResolveMonorepo(join(fixturePath, 'ws-a'))
    expect(monorepo).not.toBeNull()
    expect(monorepo!.path).toBe(fixturePath)
  })

  it('should return null when no monorepo found', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'no-monorepo-'))
    const nestedDir = join(tmpDir, 'a', 'b')
    await mkdir(nestedDir, { recursive: true })
    try {
      const result = await tryResolveMonorepo(nestedDir)
      expect(result).toBeNull()
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })
})
