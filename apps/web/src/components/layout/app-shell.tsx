import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** F0 placeholder shell — F1.2 builds the real SideNav/TopBar/AlertsBell.
 *  The 9 walkthrough entries + System (docs/11 §2). */
const NAV = [
  { to: '/overview', label: 'Overview' },
  { to: '/leads', label: 'Leads' },
  { to: '/mailboxes', label: 'Mailboxes' },
  { to: '/sequences', label: 'Sequences' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/unibox', label: 'Unibox' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/cold-storage', label: 'Cold Storage' },
  { to: '/settings', label: 'Settings' },
  { to: '/system', label: 'System' },
];

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 border-r border-border bg-sidebar p-4">
        <p className="mb-4 text-sm font-semibold text-sidebar-foreground">Cold Email</p>
        <ul className="space-y-1">
          {NAV.map((entry) => (
            <li key={entry.to}>
              <NavLink
                to={entry.to}
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                  )
                }
              >
                {entry.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
