import { useRef, useState, type ReactNode } from 'react';
import { Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export function ResponsiveFilters({
  children,
  activeCount = 0,
  title = 'Filters',
  description = 'Narrow the records shown on this screen.',
  className,
}: {
  children: ReactNode;
  activeCount?: number;
  title?: string;
  description?: string;
  className?: string;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const setSheetOpen = (next: boolean) => {
    setOpen(next);
    if (!next) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (!mobile) {
    return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        className="w-full justify-between"
        onClick={() => setSheetOpen(true)}
      >
        <span className="flex items-center gap-2">
          <Filter className="size-4" /> {title}
        </span>
        {activeCount > 0 && <Badge variant="secondary">{activeCount} active</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[min(22rem,92vw)]">
          <SheetHeader className="border-b border-border px-0 pt-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=input]]:w-full">
            {children}
          </div>
          <SheetFooter className="border-t border-border px-0 pb-0">
            <Button onClick={() => setSheetOpen(false)}>Show results</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
