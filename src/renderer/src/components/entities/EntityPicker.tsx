import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type Entity, type EntityType } from '@shared/entity-types'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'

interface EntityPickerProps {
  /** The eligible entities — the caller pre-filters by type. */
  entities: Entity[]
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** Bucket items under their type headings (canonical order). Default true. */
  groupByType?: boolean
  disabled?: boolean
  className?: string
}

/**
 * A single-select entity combobox (Popover + cmdk Command). Generalized from Converse's target picker so
 * the Lore prebuilt-prompt slots (and, later, Converse) share one implementation. cmdk searches on the
 * entity NAME (`value="{name} {id}"`, id disambiguating duplicate names); the trigger disables itself when
 * there is nothing to pick.
 */
export function EntityPicker({
  entities,
  value,
  onChange,
  placeholder = 'Choose an entity…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  groupByType = true,
  disabled = false,
  className
}: EntityPickerProps) {
  const [open, setOpen] = useState(false)
  const chosen = entities.find((e) => e.id === value) ?? null
  const groups: { type: EntityType | null; items: Entity[] }[] = groupByType
    ? ENTITY_TYPES.map((type) => ({ type, items: entities.filter((e) => e.type === type) })).filter(
        (g) => g.items.length > 0
      )
    : [{ type: null, items: entities }]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || entities.length === 0}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen ? chosen.name : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup
                key={g.type ?? 'all'}
                heading={g.type ? ENTITY_TYPE_LABELS[g.type] : undefined}
              >
                {g.items.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.name} ${e.id}`}
                    onSelect={() => {
                      onChange(e.id)
                      setOpen(false)
                    }}
                  >
                    <Check className={cn('size-4', value === e.id ? 'opacity-100' : 'opacity-0')} />
                    {e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
