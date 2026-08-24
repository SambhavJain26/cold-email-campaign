import { useState } from 'react';
import { Check, ChevronsUpDown, RefreshCw } from 'lucide-react';
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

export interface FolderOption {
  name: string;
  special_use?: string | null;
}

export function FolderMultiSelect({
  value,
  options,
  onChange,
  onRefresh,
  refreshing,
}: {
  value: string[];
  options: FolderOption[];
  onChange: (value: string[]) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const merged = [...options];
  for (const selected of value) {
    if (!merged.some((option) => option.name === selected)) merged.push({ name: selected });
  }
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="min-h-9 w-full justify-between font-normal"
          >
            <span className="truncate">
              {value.length > 0 ? value.join(', ') : 'Select folders…'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search folders…" />
            <CommandList>
              <CommandEmpty>No folder found. Refresh discovery after connecting.</CommandEmpty>
              <CommandGroup>
                {merged.map((folder) => {
                  const checked = value.includes(folder.name);
                  return (
                    <CommandItem
                      key={folder.name}
                      value={folder.name}
                      onSelect={() =>
                        onChange(
                          checked
                            ? value.filter((candidate) => candidate !== folder.name)
                            : [...value, folder.name],
                        )
                      }
                    >
                      <Check className={cn('size-4', checked ? 'opacity-100' : 'opacity-0')} />
                      <span>{folder.name}</span>
                      {folder.special_use && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {folder.special_use}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {onRefresh && (
        <Button type="button" size="xs" variant="ghost" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          Discover folders
        </Button>
      )}
    </div>
  );
}
