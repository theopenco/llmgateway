export interface ModelRatingsData {
	ratingCount: number;
	averageRating: number | null;
	reviews: {
		rating: number;
		comment: string;
		authorName: string;
		createdAt: string;
	}[];
}

export function hasFullRatingData(ratings: ModelRatingsData | null) {
	return Boolean(
		ratings &&
			ratings.ratingCount > 0 &&
			ratings.averageRating &&
			ratings.reviews.length > 0,
	);
}

export function buildRatingSchema(ratings: ModelRatingsData | null) {
	if (!ratings || ratings.ratingCount === 0 || !ratings.averageRating) {
		return {};
	}

	return {
		aggregateRating: {
			"@type": "AggregateRating",
			ratingValue: ratings.averageRating,
			ratingCount: ratings.ratingCount,
			bestRating: 5,
			worstRating: 1,
		},
		...(ratings.reviews.length > 0
			? {
					review: ratings.reviews.map((r) => ({
						"@type": "Review",
						reviewRating: {
							"@type": "Rating",
							ratingValue: r.rating,
							bestRating: 5,
							worstRating: 1,
						},
						author: {
							"@type": "Person",
							name: r.authorName,
						},
						reviewBody: r.comment,
						datePublished: r.createdAt.slice(0, 10),
					})),
				}
			: {}),
	};
}
