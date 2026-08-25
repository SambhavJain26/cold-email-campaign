import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
];

function allTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  return [...new Set(['UTC', ...(intl.supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES)])];
}

function offsetLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((candidate) => candidate.type === 'timeZoneName')?.value;
    return part ? `${timeZone} (${part.replace('GMT', 'UTC')})` : timeZone;
  } catch {
    return timeZone;
  }
}

export function TimezoneCombobox({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => allTimezones(), []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="min-h-9 w-full justify-between font-normal"
        >
          <span className="truncate">{value ? offsetLabel(value) : 'Select timezone…'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command
          onWheel={(event) => {
            const list = event.currentTarget.querySelector<HTMLElement>(
              '[data-slot="command-list"]',
            );
            if (!list || event.deltaY === 0) return;
            list.scrollTop += event.deltaY;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <CommandInput placeholder="Search timezones…" />
          <CommandList className="overscroll-contain">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  value={`${zone} ${offsetLabel(zone)}`}
                  onSelect={() => {
                    onChange(zone);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('size-4', value === zone ? 'opacity-100' : 'opacity-0')} />
                  {offsetLabel(zone)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
