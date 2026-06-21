/**
 * Description — Server Component.
 *
 * Plain heading + flowing paragraph (design revision — no card, no collapse).
 * Preserves author line breaks (whitespace-pre-line).
 */

export function Description({ text }: { text: string }) {
  return (
    <section className='flex flex-col gap-3.5'>
      <h2 className='font-display text-[20px] font-semibold'>Описание</h2>
      <p className='whitespace-pre-line text-body-l leading-[1.65] text-[#3A3A3A] [text-wrap:pretty]'>
        {text}
      </p>
    </section>
  );
}
