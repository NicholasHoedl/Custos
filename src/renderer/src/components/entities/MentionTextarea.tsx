import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentPropsWithRef, FocusEvent, KeyboardEvent, SyntheticEvent } from 'react'
import { ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/store/app-store'
import { useEntities } from '@renderer/hooks/use-ledger'
import { ENTITY_TYPE_COLOR, ENTITY_TYPE_ICON } from '@renderer/lib/entity-visuals'
import { Textarea } from '@renderer/components/ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import { parseMentionToken, rankEntities } from '@renderer/lib/mention'

type NativeTextareaProps = Omit<ComponentPropsWithRef<'textarea'>, 'value' | 'onChange'>

interface MentionTextareaProps extends NativeTextareaProps {
  value: string
  onValueChange: (value: string) => void
  /** Override the fetched campaign entities — e.g. a list-heavy parent that already holds them. */
  entities?: Entity[]
  /** Restrict which entity types the menu offers. Default: all types. */
  types?: EntityType[]
  /** Which side of the textarea the menu prefers (flips on collision). Default 'bottom'. */
  menuSide?: 'top' | 'bottom'
  /** Campaign whose entities to offer. Defaults to the app-active campaign. */
  campaignId?: string | null
}

/**
 * A drop-in for the shadcn `<Textarea>` with inline entity autocomplete ("quick write"): typing `/npc`
 * (or `/loc`, `/que`, …) at the caret opens a filtered menu of that entity type; picking one drops the
 * entity's plain name in place of the `/npc…` token. Reuses the caller's plain `value`/`onValueChange`
 * contract, so a call site converts by swapping `<Textarea onChange={e => setX(e.target.value)}>` →
 * `<MentionTextarea onValueChange={setX}>` and keeping every other prop.
 *
 * The menu is driven entirely from the textarea's own keyboard — focus never leaves it (arrows move the
 * highlight, Enter/Tab pick, Escape dismisses; Ctrl/Cmd+Enter is forwarded so composer-submit still
 * fires) — so it's a plain list, not cmdk. A null campaign yields no entities, degrading to a plain
 * textarea. See `lib/mention.ts` for the pure token parser + ranker.
 */
export function MentionTextarea({
  value,
  onValueChange,
  entities: entitiesProp,
  types,
  menuSide = 'bottom',
  campaignId,
  onKeyDown,
  onBlur,
  onSelect,
  className,
  ...rest
}: MentionTextareaProps) {
  const activeCampaignId = useAppStore((s) => s.activeCampaignId)
  const { entities: fetched } = useEntities(campaignId ?? activeCampaignId)
  const source = entitiesProp ?? fetched

  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const listboxId = useId()

  const [caret, setCaret] = useState<number | null>(null)
  const [manualClose, setManualClose] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const token = useMemo(() => (caret == null ? null : parseMentionToken(value, caret)), [value, caret])
  const results = useMemo(() => {
    if (!token) return []
    const pool = types ? source.filter((e) => types.includes(e.type)) : source
    return rankEntities(pool, token)
  }, [token, source, types])

  const open = token != null && results.length > 0 && !manualClose
  const active = Math.min(highlight, results.length - 1) // clamp: results can shrink under a stale index

  // Reset the highlight to the top whenever the token identity changes (a new filter char, a moved caret).
  useEffect(() => {
    setHighlight(0)
  }, [token?.type, token?.filter, token?.start])

  // After a pick, the parent re-renders with the new controlled value; restore the caret past the inserted
  // name here (a controlled textarea would otherwise park it) once the DOM holds the new value.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && pendingCaret.current != null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
      el.focus()
      pendingCaret.current = null
    }
  })

  function select(entity: Entity): void {
    if (!token) return
    // Trailing space to keep typing — unless the caret already sits before whitespace (mid-sentence edit).
    const insert = entity.name + (/\s/.test(value[token.end] ?? '') ? '' : ' ')
    const next = value.slice(0, token.start) + insert + value.slice(token.end)
    pendingCaret.current = token.start + insert.length
    setCaret(pendingCaret.current) // recompute token now → no '/' left → menu closes this render
    onValueChange(next)
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>): void {
    setManualClose(false) // typing re-opens after an Escape
    setCaret(e.target.selectionStart)
    onValueChange(e.target.value)
  }

  function handleSelect(e: SyntheticEvent<HTMLTextAreaElement>): void {
    setCaret(e.currentTarget.selectionStart)
    onSelect?.(e)
  }

  function handleBlur(e: FocusEvent<HTMLTextAreaElement>): void {
    setManualClose(true)
    onBlur?.(e)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (open && !e.nativeEvent.isComposing) {
      const count = results.length
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlight((h) => (Math.min(h, count - 1) + 1) % count)
          return
        case 'ArrowUp':
          e.preventDefault()
          setHighlight((h) => (Math.min(h, count - 1) - 1 + count) % count)
          return
        case 'Enter':
          if (e.ctrlKey || e.metaKey) break // Ctrl/Cmd+Enter = composer submit → forward below
          e.preventDefault()
          e.stopPropagation()
          select(results[active])
          return
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          select(results[active])
          return
        case 'Escape':
          e.preventDefault()
          e.stopPropagation() // dismiss the menu only — don't also cancel an edit / close a Dialog
          setManualClose(true)
          return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!o) setManualClose(true)
      }}
    >
      <PopoverAnchor asChild>
        <Textarea
          {...rest}
          ref={ref}
          value={value}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={className}
          // Combobox semantics apply only while the menu is open — the rest of the time this is a plain
          // prose textarea, so it shouldn't announce as (or match role queries for) a combobox.
          role={open ? 'combobox' : undefined}
          aria-expanded={open ? true : undefined}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-opt-${active}` : undefined}
        />
      </PopoverAnchor>
      <PopoverContent
        id={listboxId}
        role="listbox"
        side={menuSide}
        align="start"
        sideOffset={4}
        avoidCollisions
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="max-h-72 w-[var(--radix-popover-trigger-width)] min-w-48 overflow-y-auto p-1"
      >
        {results.map((entity, i) => {
          const Icon = ENTITY_TYPE_ICON[entity.type]
          const isActive = i === active
          const dim = entity.lifecycle === 'ended' || entity.lifecycle === 'presumed_ended'
          return (
            <div
              key={entity.id}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={isActive}
              onMouseDown={(ev) => ev.preventDefault()} // keep focus in the textarea through a click
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(entity)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
                dim && 'opacity-60'
              )}
            >
              <Icon className="size-3.5 shrink-0" style={{ color: ENTITY_TYPE_COLOR[entity.type] }} />
              <span className="truncate">{entity.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {ENTITY_TYPE_LABELS[entity.type]}
              </span>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
