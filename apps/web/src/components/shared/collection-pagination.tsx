import type { MouseEvent } from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

export interface CollectionPaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

function pageTokens(page: number, lastPage: number): Array<number | 'ellipsis'> {
  if (lastPage <= 7) return Array.from({ length: lastPage }, (_, index) => index + 1);
  const pages = new Set([1, lastPage, page - 1, page, page + 1]);
  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= lastPage)
    .sort((a, b) => a - b);
  const result: Array<number | 'ellipsis'> = [];
  for (const value of sorted) {
    const previous = result.at(-1);
    if (typeof previous === 'number' && value - previous > 1) result.push('ellipsis');
    result.push(value);
  }
  return result;
}

export function CollectionPagination({
  page,
  perPage,
  total,
  onPageChange,
}: CollectionPaginationProps) {
  if (total <= perPage) return null;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const go = (next: number) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (next >= 1 && next <= lastPage && next !== page) onPageChange(next);
  };
  return (
    <div className="flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
      <span className="tabular-nums" aria-live="polite">
        {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
      </span>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious disabled={page <= 1} onClick={go(page - 1)} />
          </PaginationItem>
          {pageTokens(page, lastPage).map((token, index) =>
            token === 'ellipsis' ? (
              <PaginationItem key={`ellipsis-${index}`} className="hidden sm:block">
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={token} className="hidden sm:block">
                <PaginationLink isActive={token === page} onClick={go(token)}>
                  {token}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext disabled={page >= lastPage} onClick={go(page + 1)} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
