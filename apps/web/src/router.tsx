// F0.5 — route table (docs/11 §2). /login public; everything else behind
// RequireAuth inside the AppShell. Detail routes land with their F-stages.
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth } from '@/components/layout/require-auth';
import LoginPage from '@/features/auth/login-page';
import OverviewPage from '@/features/overview/page';
import LeadsPage from '@/features/leads/page';
import LeadDetailPage from '@/features/leads/detail-page';
import MailboxesPage from '@/features/mailboxes/page';
import SequencesPage from '@/features/sequences/page';
import SequenceBuilderPage from '@/features/sequences/builder-page';
import CampaignsPage from '@/features/campaigns/page';
import CampaignDetailPage from '@/features/campaigns/detail-page';
import UniboxPage from '@/features/unibox/page';
import AnalyticsPage from '@/features/analytics/page';
import ColdStoragePage from '@/features/coldstorage/page';
import SettingsPage from '@/features/settings/page';
import SystemPage from '@/features/system/page';

const basename =
  import.meta.env.BASE_URL === '/' ? '/' : import.meta.env.BASE_URL.replace(/\/$/, '');

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppShell />,
          children: [
            { path: '/', element: <Navigate to="/overview" replace /> },
            { path: '/overview', element: <OverviewPage /> },
            { path: '/leads', element: <LeadsPage /> },
            { path: '/leads/:id', element: <LeadDetailPage /> },
            { path: '/mailboxes', element: <MailboxesPage /> },
            { path: '/sequences', element: <SequencesPage /> },
            { path: '/sequences/:id', element: <SequenceBuilderPage /> },
            { path: '/campaigns', element: <CampaignsPage /> },
            { path: '/campaigns/:id', element: <CampaignDetailPage /> },
            { path: '/unibox', element: <UniboxPage /> },
            { path: '/analytics', element: <AnalyticsPage /> },
            { path: '/cold-storage', element: <ColdStoragePage /> },
            { path: '/settings', element: <SettingsPage /> },
            { path: '/system', element: <SystemPage /> },
          ],
        },
      ],
    },
    { path: '*', element: <Navigate to="/overview" replace /> },
  ],
  { basename },
);
