import { CabinetDashboard } from '@/components/cabinet/CabinetDashboard';

/*
 * Cabinet dashboard route (/cabinet). Thin RSC shell — the list is authed data
 * loaded by the CabinetDashboard client island via a buffered Route Handler
 * (authedFetch cannot run during RSC render; see lib/partner/operations.ts).
 */
export default function CabinetPage() {
  return <CabinetDashboard />;
}
