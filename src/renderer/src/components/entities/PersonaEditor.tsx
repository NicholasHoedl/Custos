import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { PersonaBrief } from '@shared/recall-types'
import { ledger } from '@renderer/lib/ipc'
import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'

// The in-character persona for a PC (used by Recall). Generated from the character's fields; editable.
export function PersonaEditor({ entityId }: { entityId: string }) {
  const [persona, setPersona] = useState<PersonaBrief | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let ignore = false
    setLoading(true)
    ledger.persona.get(entityId).then((p) => {
      if (ignore) return
      setPersona(p)
      setDraft(p?.brief ?? '')
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [entityId])

  async function generate() {
    setBusy(true)
    try {
      const p = await ledger.persona.generate(entityId)
      setPersona(p)
      setDraft(p.brief)
      toast.success('Persona generated')
    } catch (err) {
      toast.error('Could not generate persona', {
        description: 'Needs an API key and a connection. ' + String(err)
      })
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    try {
      const p = await ledger.persona.update(entityId, draft)
      setPersona(p)
      toast.success('Persona saved')
    } catch (err) {
      toast.error('Could not save persona', { description: String(err) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Persona</h3>
          {persona?.stale && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
              May be out of date
            </span>
          )}
          {persona?.edited && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Edited
            </span>
          )}
        </div>
        {persona && (
          <Button variant="ghost" size="sm" onClick={generate} disabled={busy}>
            <RefreshCw className="size-3.5" />
            Regenerate
          </Button>
        )}
      </div>

      {!persona ? (
        <div className="rounded-md border border-dashed border-border p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Generate an in-character voice for Recall, from this character&apos;s traits and goals.
          </p>
          <Button size="sm" className="mt-2" onClick={generate} disabled={busy}>
            <Sparkles className="size-3.5" />
            {busy ? 'Generating…' : 'Generate persona'}
          </Button>
        </div>
      ) : (
        <>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            className="font-mono text-xs leading-relaxed"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={busy || draft === persona.brief}>
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
