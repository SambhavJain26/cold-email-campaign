import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState } from './empty-state';
import { CollectionPagination } from './collection-pagination';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-align numerics (docs/11 §5). */
  align?: 'left' | 'right';
  className?: string;
  /** Hide low-value detail from the generated phone card. */
  hideOnMobile?: boolean;
}

export interface DataTablePagination {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  pageSizeOptions?: readonly number[];
  paginationLabel?: string;
}

/** Dense table with sticky header + contract-shaped pagination (docs/11 §5).
 *  Deliberately TanStack-free: plain rows in, list-envelope numbers in. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowTestId,
  pagination,
  emptyTitle = 'Nothing here yet',
  onRowClick,
  className,
  mobileCard,
}: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string | number;
  rowTestId?: (row: T) => string;
  pagination?: DataTablePagination;
  emptyTitle?: string;
  onRowClick?: (row: T) => void;
  className?: string;
  mobileCard?: (row: T) => ReactNode;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} className={className} />;
  }
  return (
    <div className={cn('space-y-2', className)}>
      <div className="space-y-2 md:hidden" data-testid="mobile-card-list">
        {rows.map((row) => {
          const content = mobileCard ? (
            mobileCard(row)
          ) : (
            <dl className="space-y-2">
              {columns
                .filter((column) => !column.hideOnMobile)
                .map((column, index) => (
                  <div
                    key={column.key}
                    className={cn(
                      index === 0
                        ? 'border-b border-border/70 pb-2 font-medium'
                        : 'flex min-w-0 items-start justify-between gap-3',
                    )}
                  >
                    {index > 0 && (
                      <dt className="shrink-0 text-xs text-muted-foreground">{column.header}</dt>
                    )}
                    <dd className={cn('min-w-0 text-sm', index > 0 && 'text-right')}>
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
            </dl>
          );
          return (
            <div
              key={rowKey(row)}
              onClick={onRowClick && !mobileCard ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick && !mobileCard
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              role={onRowClick && !mobileCard ? 'button' : undefined}
              tabIndex={onRowClick && !mobileCard ? 0 : undefined}
              className={cn(
                'min-w-0',
                !mobileCard && 'rounded-lg border border-border bg-card p-4 shadow-xs',
                onRowClick &&
                  !mobileCard &&
                  'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {content}
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    'h-8 text-xs',
                    col.align === 'right' && 'text-right',
                    col.className,
                  )}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                data-testid={rowTestId?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      'py-1.5 text-sm',
                      col.align === 'right' && 'text-right tabular-nums',
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pagination && <CollectionPagination {...pagination} />}
    </div>
  );
}
