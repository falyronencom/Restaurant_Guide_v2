import { CabinetDashboard } from '@/components/cabinet/CabinetDashboard';

/*
 * Cabinet dashboard route (/cabinet). Thin RSC shell — the list is authed data
 * loaded by the CabinetDashboard client island via a Server Action (authedFetch
 * cannot run during RSC render; see lib/partner/actions.ts).
 */
export default function CabinetPage() {
  return <CabinetDashboard />;
}
