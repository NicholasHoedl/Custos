import { describe, it, expect, vi } from 'vitest'

// claude.service transitively imports electron (via key.service); stub it so the pure request builder
// imports under the node test runtime (mirrors converse-prompt.test.ts).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ledger-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { buildStructuredParams, supportsAdaptiveThinking } = await import(
  '../../../src/main/services/claude.service'
)

// A minimal StructuredCallOpts, typed off the exported builder so we don't import the interface.
function opts(model: string): Parameters<typeof buildStructuredParams>[0] {
  return {
    feature: 'illuminate',
    model,
    effort: 'medium',
    schema: { type: 'object', additionalProperties: false },
    system: [{ type: 'text', text: 'sys' }],
    content: [{ type: 'text', text: 'hi' }]
  }
}

describe('supportsAdaptiveThinking', () => {
  it('excludes Haiku 4.5 — it 400s on adaptive thinking + effort', () => {
    expect(supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false)
  })
  it('includes Sonnet 4.6 and Opus 4.8', () => {
    expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
    expect(supportsAdaptiveThinking('claude-opus-4-8')).toBe(true)
  })
})

// Regression for the ADR-051 bug: Illuminate on Haiku sent adaptive thinking + effort, which Haiku 4.5
// rejects (400), and every enrich call was swallowed as "nothing new". Haiku must get a PLAIN structured
// call; Opus/Sonnet keep thinking + effort. All keep the json_schema output format.
describe('buildStructuredParams', () => {
  it('Haiku 4.5 → plain structured call: no thinking, no effort, keeps json_schema', () => {
    const p = buildStructuredParams(opts('claude-haiku-4-5'))
    expect(p.thinking).toBeUndefined()
    expect(p.output_config?.effort).toBeUndefined()
    expect(p.output_config?.format).toMatchObject({ type: 'json_schema' })
  })

  it('Sonnet 4.6 → adaptive thinking + effort + json_schema', () => {
    const p = buildStructuredParams(opts('claude-sonnet-4-6'))
    expect(p.thinking).toEqual({ type: 'adaptive' })
    expect(p.output_config?.effort).toBe('medium')
    expect(p.output_config?.format).toMatchObject({ type: 'json_schema' })
  })
})
