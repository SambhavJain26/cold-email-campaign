import { useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArchiveRestore,
  BarChart3,
  Inbox,
  LayoutDashboard,
  Mail,
  Megaphone,
  MonitorCog,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TopBar } from './top-bar';
import { TransportChip } from './transport-chip';
import { AlertsBell } from './alerts-bell';
import { UpdateAvailableBanner } from './update-available-banner';

/** The walkthrough's 9 entries + System, with their docs/11 §2 glyphs. */
const NAV: Array<{ to: string; icon: LucideIcon; label: string }> = [
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/leads', icon: Users, label: 'Leads' },
  { to: '/mailboxes', icon: Mail, label: 'Mailboxes' },
  { to: '/sequences', icon: Workflow, label: 'Sequences' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/unibox', icon: Inbox, label: 'Unibox' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/cold-storage', icon: ArchiveRestore, label: 'Cold Storage' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/system', icon: MonitorCog, label: 'System' },
];

function PrimaryNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      <ul className="space-y-1">
        {NAV.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.to}>
              <NavLink
                to={entry.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground',
                  )
                }
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {entry.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const activeLabel =
    NAV.find((entry) => location.pathname.startsWith(entry.to))?.label ?? 'Cold Email';
  const setNavigation = (open: boolean) => {
    setNavigationOpen(open);
    if (!open) window.requestAnimationFrame(() => navigationTriggerRef.current?.focus());
  };

  return (
    <div className="flex h-[100dvh] max-w-full overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-md bg-background px-4 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <aside className="hidden h-[100dvh] w-52 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <p className="shrink-0 px-4 py-4 text-sm font-semibold text-sidebar-foreground">
          Cold Email
        </p>
        <PrimaryNavigation />
      </aside>
      <Sheet open={navigationOpen} onOpenChange={setNavigation}>
        <SheetContent
          side="left"
          className="w-[min(19rem,88vw)] gap-0 p-0 md:hidden"
          aria-label="Mobile navigation"
        >
          <SheetHeader className="border-b border-border pr-14">
            <SheetTitle>Cold Email</SheetTitle>
            <SheetDescription>{activeLabel}</SheetDescription>
          </SheetHeader>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TransportChip />
            <span className="text-xs text-muted-foreground">Transport</span>
            <div className="ml-auto">
              <AlertsBell />
            </div>
          </div>
          <PrimaryNavigation onNavigate={() => setNavigation(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onOpenNavigation={() => setNavigation(true)}
          navigationTriggerRef={navigationTriggerRef}
        />
        <UpdateAvailableBanner />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
