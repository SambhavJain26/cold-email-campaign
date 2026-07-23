import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
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
  pagination,
  emptyTitle = 'Nothing here yet',
  onRowClick,
  className,
}: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string | number;
  pagination?: DataTablePagination;
  emptyTitle?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} className={className} />;
  }
  const lastPage = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.perPage)) : 1;
  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-x-auto rounded-lg border border-border">
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
      {pagination && pagination.total > pagination.perPage && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            {(pagination.page - 1) * pagination.perPage + 1}-
            {Math.min(pagination.page * pagination.perPage, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= lastPage}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
