import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import type { Lifecycle } from '@shared/entity-types'
import type { StatusPreset } from '@shared/entity-profiles'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

interface StatusComboboxProps {
  value: string
  // A preset passes its implied lifecycle; custom text / clear pass `undefined` so the caller derives one.
  onChange: (value: string, lifecycle: Lifecycle | undefined) => void
  options: readonly StatusPreset[]
  id?: string
}

// Status picker: pick a curated preset (which also sets the coarse lifecycle) OR type a custom value
// ("Use '<typed>'", lifecycle then derived from the text). Reuses the Popover + Command pattern from the
// relationship entity picker. Any current value (incl. legacy/custom) shows in the trigger.
export function StatusCombobox({ value, onChange, options, id }: StatusComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  function commit(next: string, lifecycle: Lifecycle | undefined) {
    onChange(next, lifecycle)
    setQuery('')
    setOpen(false)
  }

  const trimmed = query.trim()
  const showCustom =
    trimmed.length > 0 && !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!value && 'text-muted-foreground')}>{value || 'Set status…'}</span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Type to add a custom status.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.label}
                  value={opt.label}
                  onSelect={() => commit(opt.label, opt.lifecycle)}
                >
                  <Check
                    className={cn('size-4', value === opt.label ? 'opacity-100' : 'opacity-0')}
                  />
                  {opt.label}
                  {(opt.lifecycle === 'ended' || opt.lifecycle === 'presumed_ended') && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {opt.lifecycle === 'presumed_ended' ? 'presumed ended' : 'ended'}
                    </span>
                  )}
                </CommandItem>
              ))}
              {showCustom && (
                <CommandItem value={trimmed} onSelect={() => commit(trimmed, undefined)}>
                  <Check className="size-4 opacity-0" />
                  Use “{trimmed}”
                </CommandItem>
              )}
              {value && (
                <CommandItem value="__clear-status__" onSelect={() => commit('', undefined)}>
                  <X className="size-4" />
                  Clear status
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
