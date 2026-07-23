/** Temporary stand-in for a feature screen - each F-stage replaces its stubs. */
export function PageStub({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Screen not built yet.</p>
    </div>
  );
}
