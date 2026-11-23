import { MenuSection } from '@/components/cabinet/menu/MenuSection';

/*
 * The card's «Меню» section (/cabinet/[id]/menu): the recognised dishes by
 * section, their prices and marks, the edit of a line, the restart of the
 * recognition. Guarded and noindex by the (cabinet) layout; the card's header
 * and sections come from [id]/layout.tsx. A thin RSC shell around the client
 * island.
 */
export default async function CardMenuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MenuSection id={id} />;
}
