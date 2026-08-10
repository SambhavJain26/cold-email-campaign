import { JobStatus } from './job-status';
import { ReplyDetectionTable } from './reply-detection';

/** F8.1/F8.2 — System (docs/12 §11): job status + the reply-detection debug view. */
export default function SystemPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">System</h1>
        <p className="text-xs text-muted-foreground">All campaigns</p>
      </div>
      <JobStatus />
      <ReplyDetectionTable />
    </div>
  );
}
