/**
 * sync-icons.mjs — bridge the category + cuisine SVG icons and the hero
 * background from the mobile asset set into web/public.
 *
 * Why a copy (not a cross-package import): mobile/assets lives outside the
 * Next module graph; importing across ../mobile is fragile and would couple
 * the web build/deploy to the mobile package being present. We copy once and
 * COMMIT the output so the web build is self-contained (Railway deploys web in
 * isolation). This script is the provenance record + regeneration path; run it
 * after the mobile icon set changes:
 *
 *     node scripts/sync-icons.mjs        (from the web/ directory)
 *
 * Attribute (amenity) icons ARE copied as of 2026-06-21 (vitrine revision) —
 * this supersedes the 2026-05-26 "web keeps lucide-react for amenities"
 * decision; the design handoff uses the brand SVG set on both surfaces.
 *
 * Intentionally NOT copied:
 *   - Континентальная.svg — legacy "continental" folds into european
 *
 * Filename note: category `fast-food` (Cyrillic display «Фаст-фуд») ships as
 * `ФастФуд.svg` (camelCase, no hyphen). The basenames below are the ACTUAL
 * file names; the slug→file mapping lives in src/lib/category-icons.ts.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '..', '..');
const MOBILE_ICONS = join(REPO_ROOT, 'mobile', 'assets', 'icons');
const MOBILE_IMAGES = join(REPO_ROOT, 'mobile', 'assets', 'images');
const WEB_PUBLIC = join(here, '..', 'public');
const WEB_ICONS = join(WEB_PUBLIC, 'icons');

// Cyrillic icon basenames to copy — mirror of the slug→icon map in
// src/lib/category-icons.ts. Keep the two in sync.
const ICON_FILES = [
  // categories (15)
  'Ресторан', 'Кафе', 'Кофейня', 'Бар', 'Пиццерия', 'Пекарня', 'Кондитерская',
  'ФастФуд', 'Паб', 'Столовая', 'Кальянная', 'Боулинг', 'Караоке', 'Бильярд', 'Клуб',
  // cuisines (12)
  'Народная', 'Авторская', 'Азиатская', 'Американская', 'Вегетарианская', 'Японская',
  'Грузинская', 'Итальянская', 'Смешанная', 'Европейская', 'Китайская', 'Восточная',
  // attributes / amenities (9) — mirror ATTRIBUTE_ICON_BY_SLUG in src/lib/category-icons.ts
  'Wifi', 'Парковка', 'Терасса', 'Животные', 'Доставка еды', 'Детская зона',
  'Банкет', 'Курение', 'Живая музыка',
];

async function main() {
  await mkdir(WEB_ICONS, { recursive: true });

  let copied = 0;
  for (const base of ICON_FILES) {
    await copyFile(
      join(MOBILE_ICONS, `${base}.svg`),
      join(WEB_ICONS, `${base}.svg`),
    );
    copied += 1;
  }

  await copyFile(
    join(MOBILE_IMAGES, 'search_background.jpg'),
    join(WEB_PUBLIC, 'search_background.jpg'),
  );

  console.log(`sync-icons: copied ${copied} icons + 1 background → web/public`);
}

main().catch((err) => {
  console.error('sync-icons failed:', err);
  process.exit(1);
});
