import { z } from 'zod'
import type { ZodError } from 'zod'

export const envConfigSchema = z.object({
  backend_file: z.string().optional(),
  backend_type: z.string().optional(),
  backend_config: z.record(z.string()).optional(),
  vars: z
    .record(z.coerce.string())
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  var_files: z
    .array(z.string())
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
})

export const workspaceConfigSchema = z.object({
  provider: z.string().optional(),
  injection: z.record(z.string()).optional(),
  output: z.record(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  envs: z.record(envConfigSchema).optional(),
  alias: z.string().optional(),
})

export const monorepoConfigSchema = z.object({
  workspace: z.array(z.string()).min(1, 'At least one workspace glob is required'),
  output: z.record(z.string()).optional(),
})

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('\n')
}
