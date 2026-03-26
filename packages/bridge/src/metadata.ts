import { z } from 'zod'
import { logger } from './logger.js'

const metadataSchema = z.object({
  level: z.number().int().positive(),
  workspaces: z.array(z.string().min(1)).min(1),
  planId: z.string().min(1),
  commitSha: z.string().min(1).optional(),
})

export type IgCommentMetadata = z.infer<typeof metadataSchema>

const IG_META_PATTERN = /<!-- ig-meta:(.*?) -->/s

/**
 * Parse ig-meta hidden HTML comment from a note body.
 * Returns null if no metadata found or if the metadata is invalid.
 */
export function parseMetadata(noteBody: string): IgCommentMetadata | null {
  const match = IG_META_PATTERN.exec(noteBody)
  if (!match?.[1]) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    logger.warn(`Failed to parse ig-meta JSON: ${match[1]}`)
    return null
  }

  const result = metadataSchema.safeParse(parsed)
  if (!result.success) {
    logger.warn(`Invalid ig-meta schema: ${result.error.issues.map((i) => i.message).join(', ')}`)
    return null
  }

  return result.data
}

/**
 * Serialize metadata into a hidden HTML comment for embedding in MR comments.
 */
export function serializeMetadata(metadata: IgCommentMetadata): string {
  return `<!-- ig-meta:${JSON.stringify(metadata)} -->`
}
