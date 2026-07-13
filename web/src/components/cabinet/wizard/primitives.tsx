import { cn } from '@/lib/utils';

/*
 * Shared wizard layout primitives (Phase C Slice 1, Segment B). SectionCard wraps
 * each form section; Field labels a control; Chip is the toggle used by the
 * multi-select pickers (categories / cuisines / attributes / price).
 */

export function SectionCard({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-[var(--radius-l)] border border-border bg-background p-l"
    >
      <h2 className="font-display text-headline-m text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 text-body-s text-figma-text-grey">{description}</p>
      )}
      <div className="mt-l flex flex-col gap-l">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-label-m text-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-caption-m text-figma-text-grey">{hint}</p>}
    </div>
  );
}

export function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-body-s transition-colors',
        active
          ? 'border-brand bg-brand text-text-on-primary'
          : 'border-border bg-background text-foreground hover:border-brand',
        disabled && 'cursor-not-allowed opacity-40 hover:border-border',
      )}
    >
      {children}
    </button>
  );
}
