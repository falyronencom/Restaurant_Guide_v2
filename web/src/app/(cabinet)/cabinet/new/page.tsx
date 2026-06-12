import { EstablishmentWizard } from '@/components/cabinet/wizard/EstablishmentWizard';

/*
 * New-establishment wizard route (/cabinet/new). Guarded + noindex via the
 * (cabinet) layout. The wizard is a client island (controlled state + autosave).
 */
export default function NewEstablishmentPage() {
  return <EstablishmentWizard />;
}
