import { useEffect, useId } from 'react';

const dirtyForms = new Set<string>();
export const hasUnsavedChanges = () => dirtyForms.size > 0;

export function useUnsavedChanges(dirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (dirty) dirtyForms.add(id);
    else dirtyForms.delete(id);
    return () => {
      dirtyForms.delete(id);
    };
  }, [dirty, id]);
}

export function refreshApplication(reload = () => window.location.reload()) {
  if (hasUnsavedChanges() && !window.confirm('You have unsaved changes. Discard them and refresh?'))
    return;
  reload();
}
