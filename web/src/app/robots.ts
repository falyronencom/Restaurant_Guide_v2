import type { MetadataRoute } from 'next';

import { getSiteUrl, isNoIndexMode } from '@/lib/seo-gate';

/**
 * `app/robots.ts` — Robots Exclusion Standard endpoint at `/robots.txt`.
 *
 * Gate layer 1 (CAT-C-1.2): when `NOINDEX_MODE` is engaged we emit
 * `User-Agent: * / Disallow: /` and omit the sitemap reference — the
 * strongest signal to crawlers that nothing here should be indexed yet.
 *
 * When the gate is off:
 *   - General crawlers: `Allow: /` with `Disallow: /api/` (route handlers
 *     are not human-facing surface)
 *   - Sitemap reference points at the canonical sitemap.xml
 *   - Filter query-strings are intentionally NOT disallowed — CAT-C-2.3
 *     canonical consolidation handles them at metadata level; blocking via
 *     robots.txt would break that mechanism
 *
 * AI training/retrieval bot blocks (Trunk Flag 2) are present in BOTH gate
 * states — Anthropic, OpenAI, Google-Extended, Common Crawl, Bytedance,
 * Perplexity, ChatGPT-User, Applebot-Extended. These are declarations of
 * intent independent of the index/noindex gate.
 *
 * Next 16 Route Handler — cached by default; reads env at build time.
 */

const AI_BOT_USER_AGENTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'CCBot',
  'Bytespider',
  'PerplexityBot',
  'ChatGPT-User',
  'Applebot-Extended',
];

export default function robots(): MetadataRoute.Robots {
  const noindex = isNoIndexMode();
  const siteUrl = getSiteUrl();

  // AI blocks: always Disallow: / for all training/retrieval agents.
  const aiBlocks = AI_BOT_USER_AGENTS.map((userAgent) => ({
    userAgent,
    disallow: '/',
  }));

  if (noindex) {
    return {
      rules: [
        { userAgent: '*', disallow: '/' },
        ...aiBlocks,
      ],
      // Intentionally NO sitemap reference when gated — even if /sitemap.xml
      // responds (with empty array per gate layer 2), we don't advertise it.
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: '/api/',
      },
      ...aiBlocks,
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
