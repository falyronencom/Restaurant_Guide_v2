import { CardShell } from '@/components/cabinet/card/CardShell';

/*
 * A card in the cabinet (/cabinet/[id]/…): the card's header and the row of
 * its sections around each section's page (part 1 of «Кабинет партнёра на
 * сайте»). Guarded and noindex by the (cabinet) layout. A thin RSC shell — the
 * card is authed data, loaded by the client island through a buffered Route
 * Handler (authedFetch cannot run during RSC render).
 */
export default async function CardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CardShell id={id}>{children}</CardShell>;
}
