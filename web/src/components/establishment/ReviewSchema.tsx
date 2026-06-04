import type { PublicEstablishmentDetail, PublicReview } from '@/lib/api/types';
import { toAbsoluteUrl } from '@/lib/seo-gate';
import {
  buildAggregateRating,
  mapCategoryToSchemaSubtype,
  type AggregateRatingSchema,
} from '@/lib/schema-org';

/**
 * ReviewSchema — Server Component (/reviews route).
 *
 * Emits a MINIMAL Schema.org Restaurant (or subtype) node carrying the current
 * page's Review[] for the dedicated all-reviews page. The node's @id/url match
 * the establishment detail-page URL so search engines bind it to the same
 * entity the detail page's RestaurantSchema describes — address/geo/hours are
 * NOT duplicated here, they live on the detail node.
 *
 * Mirrors RestaurantSchema emission (standalone <script>, no wrapper library);
 * shares subtype mapping + the aggregateRating gate via @/lib/schema-org.
 *
 * Not emitted when there are no reviews: the detail RestaurantSchema already
 * represents the entity, and an empty review list adds no structured data.
 */

type Props = {
  establishment: PublicEstablishmentDetail;
  reviews: PublicReview[];
  citySlug: string;
  categorySlug: string;
};

type ReviewNode = {
  '@type': 'Review';
  author: { '@type': 'Person'; name: string };
  reviewRating: {
    '@type': 'Rating';
    ratingValue: number;
    bestRating: 5;
    worstRating: 1;
  };
  reviewBody?: string;
  datePublished: string;
};

type ReviewSchemaShape = {
  '@context': 'https://schema.org';
  '@type': string;
  '@id': string;
  url: string;
  name: string;
  review: ReviewNode[];
  aggregateRating?: AggregateRatingSchema;
};

export function ReviewSchema({
  establishment,
  reviews,
  citySlug,
  categorySlug,
}: Props) {
  if (reviews.length === 0) return null;

  // @id/url tie this Review markup to the detail page's Restaurant entity.
  const detailUrl = toAbsoluteUrl(
    `/${citySlug}/${categorySlug}/${establishment.slug}`,
  );

  const schema: ReviewSchemaShape = {
    '@context': 'https://schema.org',
    '@type': mapCategoryToSchemaSubtype(establishment.categories[0]),
    '@id': detailUrl,
    url: detailUrl,
    name: establishment.name,
    review: reviews.map((review) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: review.author.name },
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
      // reviewBody omitted when content is empty (field-presence discipline).
      ...(review.content ? { reviewBody: review.content } : {}),
      datePublished: review.created_at,
    })),
  };

  const aggregateRating = buildAggregateRating(establishment);
  if (aggregateRating) {
    schema.aggregateRating = aggregateRating;
  }

  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
