import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
}

// Controlled add/remove chip editor over a string[]. Used for traits, goals, and any list-kind profile
// field. The array stays parent-owned, so it serializes straight into the entity with no transform.
export function TagInput({ value, onChange, placeholder = 'Add…', id }: TagInputProps) {
  const [draft, setDraft] = useState('')

  function add() {
    const tag = draft.trim()
    if (!tag) return
    if (!value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag, i) => (
            <Badge key={`${tag}-${i}`} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${tag}`}
                className="rounded-sm text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              removeAt(value.length - 1)
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
    </div>
  )
}
