import { describe, it, expect, vi } from 'vitest'

// rerank.service imports electron `app`; stub it so the pure scoring helper can be imported under the
// node test runtime (the model-loading paths aren't exercised here).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ledger-test' } }))

const { applyRerankScores } = await import('../../../src/main/services/rerank.service')

const chunk = (id: string, content: string) => ({
  kind: 'note' as const,
  entityId: id,
  entityName: id,
  entityType: null,
  noteId: `n-${id}`,
  sessionId: null,
  sessionLabel: null,
  content,
  confidence: 'confirmed' as const,
  score: 0
})

describe('applyRerankScores (ADR-052 reranker ordering)', () => {
  it('sorts by cross-encoder score descending and caps to topN', () => {
    const out = applyRerankScores([chunk('a', 'A'), chunk('b', 'B'), chunk('c', 'C')], [0.1, 5.0, -2.0], 2)
    expect(out.map((c) => c.entityId)).toEqual(['b', 'a']) // 5.0 then 0.1; -2.0 (c) dropped by topN=2
    expect(out).toHaveLength(2)
  })

  it('overwrites each chunk score with its rerank score', () => {
    const out = applyRerankScores([chunk('a', 'A')], [3.14], 1)
    expect(out[0].score).toBe(3.14)
  })

  it('sends chunks with no score to the bottom (stable)', () => {
    const out = applyRerankScores([chunk('a', 'A'), chunk('b', 'B')], [], 2)
    expect(out.map((c) => c.entityId)).toEqual(['a', 'b'])
  })
})
