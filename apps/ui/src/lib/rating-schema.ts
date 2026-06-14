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

// Google only renders rating/review snippets on certain types (Product,
// SoftwareApplication, etc.) — not on Service. When this is true the page must
// use a rating-capable @type so aggregateRating/review have a valid parent node.
// Must stay in sync with the emit condition in buildRatingSchema below.
export function hasRatingData(ratings: ModelRatingsData | null) {
	return Boolean(ratings && ratings.ratingCount > 0 && ratings.averageRating);
}

export const digitalOfferFields = {
	hasMerchantReturnPolicy: {
		"@type": "MerchantReturnPolicy",
		applicableCountry: "US",
		returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
	},
	shippingDetails: {
		"@type": "OfferShippingDetails",
		shippingRate: {
			"@type": "MonetaryAmount",
			value: 0,
			currency: "USD",
		},
		shippingDestination: {
			"@type": "DefinedRegion",
			addressCountry: "US",
		},
		deliveryTime: {
			"@type": "ShippingDeliveryTime",
			handlingTime: {
				"@type": "QuantitativeValue",
				minValue: 0,
				maxValue: 0,
				unitCode: "DAY",
			},
			transitTime: {
				"@type": "QuantitativeValue",
				minValue: 0,
				maxValue: 0,
				unitCode: "DAY",
			},
		},
	},
};

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
