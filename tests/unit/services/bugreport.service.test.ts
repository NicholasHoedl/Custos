import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock electron (app paths → a scratch dir; shell spied) plus the services gatherDiagnostics composes,
// so the module graph stays light (no transformers download / DNS lookups in a unit test).
vi.mock('electron', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  return {
    app: {
      getPath: () => join(tmpdir(), 'custos-bugreport-test'),
      getVersion: () => '9.9.9'
    },
    shell: {
      openExternal: vi.fn(async () => {}),
      showItemInFolder: vi.fn()
    }
  }
})
vi.mock('electron-log/main', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('../../../src/main/services/key.service', () => ({ keyExists: () => false }))
vi.mock('../../../src/main/services/ai-util', () => ({ isOnline: async () => true }))
vi.mock('../../../src/main/services/embedding.service', () => ({ isModelReady: () => false }))
vi.mock('../../../src/main/services/rerank.service', () => ({ isRerankerReady: () => false }))
vi.mock('../../../src/main/services/entity.service', () => ({ listEntities: () => [] }))
vi.mock('../../../src/main/services/note.service', () => ({ listAllNotes: () => [] }))
vi.mock('../../../src/main/services/session.service', () => ({ listSessions: () => [] }))

import { shell } from 'electron'
import { BUG_REPORT_EMAIL } from '@shared/ipc-types'
import {
  buildFeatureMailtoUrl,
  buildMailtoUrl,
  dataUrlToImage,
  formatFeatureText,
  formatReportText,
  submitBugReport,
  submitFeatureRequest
} from '../../../src/main/services/bugreport.service'

const scratch = join(tmpdir(), 'custos-bugreport-test')
// A 1×1 transparent PNG.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

beforeEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.mocked(shell.openExternal).mockClear()
  vi.mocked(shell.showItemInFolder).mockClear()
})

describe('buildMailtoUrl', () => {
  it('targets the dev address with a subject carrying the sender and the description in the body', () => {
    const url = buildMailtoUrl('Nick', 'It broke')
    expect(url.startsWith(`mailto:${BUG_REPORT_EMAIL}?subject=`)).toBe(true)
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('Bug report from Nick')
    expect(decoded).toContain('It broke')
  })

  it('omits the from-clause when anonymous and truncates a huge description', () => {
    const url = buildMailtoUrl('  ', 'x'.repeat(5000))
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('[Custos] Bug report')
    expect(decoded).not.toContain('Bug report from')
    expect(decoded).toContain('cut off')
    expect(url.length).toBeLessThan(4000) // stays inside safe mailto territory
  })
})

describe('formatReportText', () => {
  it('carries name, description, screenshot count, and the diagnostics section', () => {
    const text = formatReportText({
      name: 'Nick',
      description: 'Broke',
      diagnostics: 'v9 diag',
      screenshots: [PNG_DATA_URL]
    })
    expect(text).toContain('From: Nick')
    expect(text).toContain('--- What went wrong ---')
    expect(text).toContain('Broke')
    expect(text).toContain('1 screenshot')
    expect(text).toContain('--- Diagnostics ---')
  })

  it('falls back to anonymous and omits an excluded diagnostics block', () => {
    const text = formatReportText({ name: '', description: 'Broke', diagnostics: null, screenshots: [] })
    expect(text).toContain('From: anonymous')
    expect(text).not.toContain('--- Diagnostics ---')
  })
})

describe('dataUrlToImage', () => {
  it('decodes png/jpeg/webp and rejects anything else', () => {
    expect(dataUrlToImage(PNG_DATA_URL)?.ext).toBe('png')
    expect(dataUrlToImage('data:image/jpeg;base64,AAAA')?.ext).toBe('jpg')
    expect(dataUrlToImage('data:image/webp;base64,AAAA')?.ext).toBe('webp')
    expect(dataUrlToImage('data:text/plain;base64,AAAA')).toBeNull()
    expect(dataUrlToImage('not a data url')).toBeNull()
  })
})

describe('submitBugReport', () => {
  it('writes the bundle, opens the mail draft, and reveals the folder', async () => {
    // Endpoint explicitly DISABLED: the baked BUG_REPORT_ENDPOINT is live now, so relying on the
    // default cfg would make unit tests POST real reports to the production worker. Always inject.
    const res = await submitBugReport(
      {
        name: 'Nick',
        description: 'It broke',
        diagnostics: 'diag block',
        screenshots: [PNG_DATA_URL, 'garbage — skipped, never sinks the report']
      },
      { endpoint: '', token: '' }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.mailOpened).toBe(true)
    if (!res.dir) throw new Error('the fallback must write the bundle dir')
    const reportPath = join(res.dir, 'report.txt')
    expect(existsSync(reportPath)).toBe(true)
    const report = readFileSync(reportPath, 'utf-8')
    expect(report).toContain('It broke')
    expect(report).toContain('diag block')
    expect(readdirSync(res.dir)).toContain('screenshot-1.png') // the garbage shot was skipped
    expect(readdirSync(res.dir)).toHaveLength(2)
    expect(vi.mocked(shell.openExternal)).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/))
    expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith(reportPath)
  })

  it('still succeeds with mailOpened=false when no mail client takes the draft', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('no client'))
    // Endpoint disabled — same reason as above: never let a unit test reach the live worker.
    const res = await submitBugReport(
      { name: '', description: 'x', diagnostics: null, screenshots: [] },
      { endpoint: '', token: '' }
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.sent).toBe(false) // endpoint disabled → the email fallback ran
      expect(res.mailOpened).toBe(false)
    }
    expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalled() // the bundle still opens
  })
})

describe('submitBugReport auto-send (ADR-058)', () => {
  const CFG = { endpoint: 'https://custos-bugreport.example.workers.dev/', token: 'tok' }

  it('POSTs the payload with the token header and skips the mail draft on success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const res = await submitBugReport(
        {
          name: 'Nick',
          replyTo: 'nick@example.com',
          description: 'It broke',
          diagnostics: 'diag block',
          screenshots: [PNG_DATA_URL]
        },
        CFG
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.sent).toBe(true)
      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string>; body: string }
      ]
      expect(url).toBe(CFG.endpoint)
      expect(init.headers['x-custos-report']).toBe('tok')
      const payload = JSON.parse(init.body)
      expect(payload.description).toBe('It broke')
      expect(payload.replyTo).toBe('nick@example.com')
      expect(payload.appVersion).toBe('9.9.9')
      expect(payload.screenshots).toHaveLength(1)
      expect(payload.screenshots[0].filename).toBe('screenshot-1.png')
      // delivered → neither the mail draft nor the folder reveal fires…
      expect(vi.mocked(shell.openExternal)).not.toHaveBeenCalled()
      expect(vi.mocked(shell.showItemInFolder)).not.toHaveBeenCalled()
      // …and NOTHING is written to disk — a delivered report leaves no local copy
      expect(res.dir).toBeNull()
      expect(existsSync(join(scratch, 'bug-reports'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to the mail draft when the endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    try {
      const res = await submitBugReport(
        { name: '', description: 'x', diagnostics: null, screenshots: [] },
        CFG
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.sent).toBe(false)
      expect(vi.mocked(shell.openExternal)).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/))
      expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ---- Feature requests (ADR-064) — a distinct email KIND to the same worker/inbox. ----

describe('buildFeatureMailtoUrl', () => {
  it('uses a feature-request subject and carries both fields in the body', () => {
    const url = buildFeatureMailtoUrl('Nick', 'Notes are hard to find', 'Add full-text search')
    expect(url.startsWith(`mailto:${BUG_REPORT_EMAIL}?subject=`)).toBe(true)
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('Feature request from Nick')
    expect(decoded).toContain('Notes are hard to find')
    expect(decoded).toContain('Add full-text search')
  })
})

describe('formatFeatureText', () => {
  it('carries name + a Problem and Proposed-feature section', () => {
    const text = formatFeatureText({
      name: 'Nick',
      problem: 'Too many clicks',
      proposedFeature: 'A shortcut'
    })
    expect(text).toContain('Custos feature request')
    expect(text).toContain('From: Nick')
    expect(text).toContain('--- Problem ---')
    expect(text).toContain('Too many clicks')
    expect(text).toContain('--- Proposed feature ---')
    expect(text).toContain('A shortcut')
  })
})

describe('submitFeatureRequest', () => {
  const CFG = { endpoint: 'https://custos-bugreport.example.workers.dev/', token: 'tok' }

  it('POSTs kind:feature with the token header and writes nothing on success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const res = await submitFeatureRequest(
        {
          name: 'Nick',
          replyTo: 'nick@example.com',
          problem: 'Notes are hard to find',
          proposedFeature: 'Add search'
        },
        CFG
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.sent).toBe(true)
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string>; body: string }
      ]
      expect(url).toBe(CFG.endpoint)
      expect(init.headers['x-custos-report']).toBe('tok')
      const payload = JSON.parse(init.body)
      expect(payload.kind).toBe('feature')
      expect(payload.problem).toBe('Notes are hard to find')
      expect(payload.proposedFeature).toBe('Add search')
      expect(payload.replyTo).toBe('nick@example.com')
      expect(payload.appVersion).toBe('9.9.9')
      expect(payload.screenshots).toBeUndefined() // feature requests carry no attachments
      // delivered → nothing on disk, no mail draft
      expect(res.dir).toBeNull()
      expect(vi.mocked(shell.openExternal)).not.toHaveBeenCalled()
      expect(existsSync(join(scratch, 'feature-requests'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to a request.txt bundle + mail draft when the endpoint is disabled', async () => {
    const res = await submitFeatureRequest(
      { name: 'Nick', problem: 'Too slow', proposedFeature: 'Cache it' },
      { endpoint: '', token: '' }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sent).toBe(false)
    if (!res.dir) throw new Error('the fallback must write the bundle dir')
    const requestPath = join(res.dir, 'request.txt')
    expect(existsSync(requestPath)).toBe(true)
    const text = readFileSync(requestPath, 'utf-8')
    expect(text).toContain('Too slow')
    expect(text).toContain('Cache it')
    expect(vi.mocked(shell.openExternal)).toHaveBeenCalledWith(expect.stringMatching(/^mailto:/))
    expect(vi.mocked(shell.showItemInFolder)).toHaveBeenCalledWith(requestPath)
  })
})
