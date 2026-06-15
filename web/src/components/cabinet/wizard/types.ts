import type { WizardFormState } from '@/lib/partner/form';

/** Common props every wizard section receives from the orchestrator. */
export type SectionProps = {
  form: WizardFormState;
  patch: (partial: Partial<WizardFormState>) => void;
  /** Read-only mode (self-suspended establishment in edit — Commit 4b). */
  disabled?: boolean;
};
