import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TopBar } from './top-bar';

/** The walkthrough's 9 entries + System, with their docs/11 §2 glyphs. */
const NAV = [
  { to: '/overview', glyph: '📊', label: 'Overview' },
  { to: '/leads', glyph: '📥', label: 'Leads' },
  { to: '/mailboxes', glyph: '📧', label: 'Mailboxes' },
  { to: '/sequences', glyph: '✍️', label: 'Sequences' },
  { to: '/campaigns', glyph: '🚀', label: 'Campaigns' },
  { to: '/unibox', glyph: '💬', label: 'Unibox' },
  { to: '/analytics', glyph: '📈', label: 'Analytics' },
  { to: '/cold-storage', glyph: '♻️', label: 'Cold Storage' },
  { to: '/settings', glyph: '⚙️', label: 'Settings' },
  { to: '/system', glyph: '🖥', label: 'System' },
];

export function AppShell() {
  // Keep the campaign context (?campaign=) when moving between screens.
  const [searchParams] = useSearchParams();
  const campaign = searchParams.get('campaign');
  const search = campaign !== null ? `?campaign=${campaign}` : '';

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
        <p className="px-4 py-3 text-sm font-semibold text-sidebar-foreground">Cold Email</p>
        <ul className="space-y-0.5 px-2">
          {NAV.map((entry) => (
            <li key={entry.to}>
              <NavLink
                to={{ pathname: entry.to, search }}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                  )
                }
              >
                <span aria-hidden className="text-base leading-none">
                  {entry.glyph}
                </span>
                {entry.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
