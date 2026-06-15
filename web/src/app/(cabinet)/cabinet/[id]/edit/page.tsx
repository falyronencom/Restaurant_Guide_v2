import { EditWizardLoader } from '@/components/cabinet/wizard/EditWizardLoader';

/*
 * Edit-establishment route (/cabinet/[id]/edit). Guarded + noindex via the
 * (cabinet) layout. A thin RSC shell that resolves the id and hands off to the
 * client loader (authed detail fetch + edit wizard).
 */
export default async function EditEstablishmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditWizardLoader id={id} />;
}
