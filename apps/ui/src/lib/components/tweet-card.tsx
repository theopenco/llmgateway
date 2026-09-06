import { Suspense } from "react";
import {
	enrichTweet,
	type EnrichedTweet,
	type TweetProps,
	type TwitterComponents,
} from "react-tweet";
import { fetchTweet, type Tweet } from "react-tweet/api";

import { cn } from "@/lib/utils";

interface TwitterIconProps {
	className?: string;
	[key: string]: unknown;
}
const Twitter = ({ className, ...props }: TwitterIconProps) => (
	<svg
		stroke="currentColor"
		fill="currentColor"
		strokeWidth="0"
		viewBox="0 0 24 24"
		height="1em"
		width="1em"
		xmlns="http://www.w3.org/2000/svg"
		className={className}
		{...props}
	>
		<use href="/landing-icons.svg#twitter" />
	</svg>
);

const Verified = ({ className, ...props }: TwitterIconProps) => (
	<svg
		aria-label="Verified Account"
		viewBox="0 0 24 24"
		className={className}
		{...props}
	>
		<use href="/landing-icons.svg#verified" />
	</svg>
);

// react-tweet's enrichTweet iterates entities.{hashtags,user_mentions,urls,symbols}
// without null checks; the syndication API sometimes omits these arrays, which
// crashes server rendering. Backfill missing arrays before passing into enrichTweet.
function normalizeEntities<T extends { entities: Tweet["entities"] }>(t: T): T {
	const entities = t.entities ?? ({} as Tweet["entities"]);
	return {
		...t,
		entities: {
			...entities,
			hashtags: entities.hashtags ?? [],
			user_mentions: entities.user_mentions ?? [],
			urls: entities.urls ?? [],
			symbols: entities.symbols ?? [],
		},
	};
}

function normalizeTweetEntities(tweet: Tweet): Tweet {
	const normalized = normalizeEntities(tweet);
	if (normalized.quoted_tweet) {
		normalized.quoted_tweet = normalizeEntities(normalized.quoted_tweet);
	}
	return normalized;
}

export const truncate = (str: string | null, length: number) => {
	if (!str || str.length <= length) {
		return str;
	}
	return `${str.slice(0, length - 3)}...`;
};

const Skeleton = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => {
	return (
		<div className={cn("rounded-md bg-primary/10", className)} {...props} />
	);
};

export const TweetSkeleton = ({
	className,
	...props
}: {
	className?: string;
	[key: string]: unknown;
}) => (
	<div
		className={cn(
			"flex size-full max-h-max min-w-72 flex-col gap-2 rounded-lg border p-4",
			className,
		)}
		{...props}
	>
		<div className="flex flex-row gap-2">
			<Skeleton className="size-10 shrink-0 rounded-full" />
			<Skeleton className="h-10 w-full" />
		</div>
		<Skeleton className="h-20 w-full" />
	</div>
);

export const TweetNotFound = ({
	className,
	...props
}: {
	className?: string;
	[key: string]: unknown;
}) => (
	<div
		className={cn(
			"flex size-full flex-col items-center justify-center gap-2 rounded-lg border p-4",
			className,
		)}
		{...props}
	>
		<h3>Tweet not found</h3>
	</div>
);

export const TweetHeader = ({ tweet }: { tweet: EnrichedTweet }) => (
	<div className="flex flex-row justify-between tracking-tight">
		<div className="flex items-center space-x-2">
			<a href={tweet.user.url} target="_blank" rel="noreferrer">
				<img
					title={`Profile picture of ${tweet.user.name}`}
					alt={tweet.user.screen_name}
					height={48}
					width={48}
					src={tweet.user.profile_image_url_https}
					loading="lazy"
					decoding="async"
					className="overflow-hidden rounded-full border border-transparent"
				/>
			</a>
			<a
				href={tweet.user.url}
				target="_blank"
				rel="noreferrer"
				className="block"
			>
				<span className="flex items-center whitespace-nowrap font-semibold">
					{truncate(tweet.user.name, 20)}
					{(tweet.user.verified || tweet.user.is_blue_verified) && (
						<Verified className="ml-1 inline size-4 text-[#1d9bf0]" />
					)}
				</span>
				<span className="block text-sm text-gray-600 dark:text-gray-300 transition-all duration-75">
					@{truncate(tweet.user.screen_name, 16)}
				</span>
			</a>
		</div>
		<a href={tweet.url} target="_blank" rel="noreferrer">
			<span className="sr-only">Link to tweet</span>
			<Twitter className="size-5 items-start text-black dark:text-white transition-all ease-in-out hover:scale-105" />
		</a>
	</div>
);

export const TweetBody = ({ tweet }: { tweet: EnrichedTweet }) => (
	<div className="break-words leading-normal tracking-tighter line-clamp-4 overflow-hidden">
		{tweet.entities.map((entity, idx) => {
			switch (entity.type) {
				case "url":
				case "symbol":
				case "hashtag":
				case "mention":
					return (
						<a
							key={idx}
							href={entity.href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm font-normal text-gray-600 underline underline-offset-2 dark:text-gray-300"
						>
							<span>{entity.text}</span>
						</a>
					);
				case "text":
					return (
						<span
							key={idx}
							className="text-sm font-normal"
							// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
							dangerouslySetInnerHTML={{ __html: entity.text }}
						/>
					);
				default:
					return null;
			}
		})}
	</div>
);

export const TweetMedia = ({ tweet }: { tweet: EnrichedTweet }) => {
	if (!tweet.video && !tweet.photos) {
		return null;
	}
	return (
		<div className="flex flex-1 items-center justify-center">
			{tweet.video && (
				<video
					poster={tweet.video.poster}
					autoPlay
					loop
					muted
					playsInline
					className="rounded-xl border shadow-sm"
				>
					<source src={tweet.video.variants[0].src} type="video/mp4" />
					Your browser does not support the video tag.
				</video>
			)}
			{tweet.photos && (
				<div className="relative flex transform-gpu snap-x snap-mandatory gap-4 overflow-x-auto">
					<div className="shrink-0 snap-center sm:w-2" />
					{tweet.photos.map((photo) => (
						<img
							key={photo.url}
							src={photo.url}
							title={"Photo by " + tweet.user.name}
							alt={tweet.text}
							loading="lazy"
							decoding="async"
							className="h-64 w-5/6 shrink-0 snap-center snap-always rounded-xl border object-cover shadow-sm"
						/>
					))}
					<div className="shrink-0 snap-center sm:w-2" />
				</div>
			)}
			{!tweet.video &&
				!tweet.photos &&
				// @ts-ignore
				tweet?.card?.binding_values?.thumbnail_image_large?.image_value.url && (
					<img
						src={
							// @ts-ignore
							tweet.card.binding_values.thumbnail_image_large.image_value.url
						}
						className="h-64 rounded-xl border object-cover shadow-sm"
						alt={tweet.text}
					/>
				)}
		</div>
	);
};

export const MagicTweet = ({
	tweet,
	className,
	...props
}: {
	tweet: Tweet;
	components?: TwitterComponents;
	className?: string;
}) => {
	const enrichedTweet = enrichTweet(tweet);
	return (
		<div
			className={cn(
				"relative flex w-full h-64 max-w-lg flex-col gap-2 overflow-hidden rounded-lg border p-4 backdrop-blur-md",
				className,
			)}
			{...props}
		>
			<TweetHeader tweet={enrichedTweet} />
			<TweetBody tweet={enrichedTweet} />
		</div>
	);
};

/**
 * TweetCard (Server Side Only)
 */
export const TweetCard = async ({
	id,
	components,
	fallback = <TweetSkeleton />,
	onError,
	...props
}: TweetProps & {
	className?: string;
}) => {
	let tweet: Tweet | undefined;

	if (!id) {
		const NotFound = components?.TweetNotFound ?? TweetNotFound;
		return <NotFound {...props} />;
	}

	try {
		const result = await fetchTweet(id);
		if (result.tombstone || result.notFound || !result.data?.user) {
			tweet = undefined;
		} else {
			tweet = normalizeTweetEntities(result.data);
		}
	} catch (err) {
		if (onError) {
			onError(err);
		} else {
			console.error("Failed to fetch tweet:", err);
		}
		tweet = undefined;
	}

	if (!tweet) {
		const NotFound = components?.TweetNotFound ?? TweetNotFound;
		return <NotFound {...props} />;
	}

	return (
		<Suspense fallback={fallback}>
			<MagicTweet tweet={tweet} {...props} />
		</Suspense>
	);
};
