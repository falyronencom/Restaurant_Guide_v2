import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Project font-size tokens — mirror of the `--text-*` scale in
 * `src/app/globals.css` `@theme`. Tailwind v4 emits each as a `text-<token>`
 * utility. Keep in sync if the @theme typography scale changes.
 */
const TEXT_SIZE_TOKENS = [
  'display-l', 'display-m', 'display-s',
  'headline-l', 'headline-m', 'headline-s',
  'body-l', 'body-m', 'body-s',
  'label-l', 'label-m', 'label-s',
  'caption-l', 'caption-m', 'caption-s',
] as const;

/**
 * tailwind-merge, taught about the design system's named font-size tokens.
 *
 * Stock tailwind-merge has no knowledge of `text-body-m`, `text-headline-l`,
 * etc. Its `text-color` group carries a catch-all validator, so these size
 * utilities fall through into `text-color`. When a size token and a real color
 * token (e.g. `text-foreground`) meet inside one `cn()` call, both resolve to
 * `text-color` and the *size* token is dropped as a same-group conflict — the
 * text silently collapses to the default size (visible only in computed
 * fontSize, never in source). Registering the tokens under the `font-size`
 * group fixes this: literal class paths win over the color validator, so the
 * size tokens leave `text-color` and now coexist with color utilities.
 *
 * See memory: feedback_tailwind_merge_text_token.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TEXT_SIZE_TOKENS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
