import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { useSequences } from '@/api/queries/sequences';
import { SequenceBuilder } from './builder';

/** F4.2 — builder route. The contract has no GET /sequences/:id — the list is the
 *  single read, so the row is picked out of it (docs/10 §Sequences). */
export default function SequenceBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const { data, isPending, isError, refetch } = useSequences();

  if (isNew) return <SequenceBuilder key="new" />;

  if (isPending) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title="Failed to load sequence"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  const sequence = data.items.find((s) => s.id === Number(id));
  if (!sequence) {
    return (
      <div className="p-6">
        <EmptyState
          title="Sequence not found"
          actionLabel="Back to sequences"
          onAction={() => navigate('/sequences')}
        />
      </div>
    );
  }

  return <SequenceBuilder key={sequence.id} sequence={sequence} />;
}
