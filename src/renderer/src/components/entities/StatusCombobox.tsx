import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
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
  onChange: (value: string) => void
  options: readonly string[]
  id?: string
}

// Status picker: pick a curated preset OR type a custom value ("Use '<typed>'"). Reuses the Popover +
// Command pattern from the relationship entity picker. Any current value (incl. legacy/custom) shows
// in the trigger.
export function StatusCombobox({ value, onChange, options, id }: StatusComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  function commit(next: string) {
    onChange(next)
    setQuery('')
    setOpen(false)
  }

  const trimmed = query.trim()
  const showCustom =
    trimmed.length > 0 && !options.some((o) => o.toLowerCase() === trimmed.toLowerCase())

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
                <CommandItem key={opt} value={opt} onSelect={() => commit(opt)}>
                  <Check className={cn('size-4', value === opt ? 'opacity-100' : 'opacity-0')} />
                  {opt}
                </CommandItem>
              ))}
              {showCustom && (
                <CommandItem value={trimmed} onSelect={() => commit(trimmed)}>
                  <Check className="size-4 opacity-0" />
                  Use “{trimmed}”
                </CommandItem>
              )}
              {value && (
                <CommandItem value="__clear-status__" onSelect={() => commit('')}>
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
