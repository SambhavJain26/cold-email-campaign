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
}

export interface DataTablePagination {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
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
      {mobileCard && (
        <div className="space-y-2 md:hidden">
          {rows.map((row) => (
            <div key={rowKey(row)}>{mobileCard(row)}</div>
          ))}
        </div>
      )}
      <div
        className={cn(
          'overflow-x-auto rounded-lg border border-border',
          mobileCard && 'hidden md:block',
        )}
      >
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
