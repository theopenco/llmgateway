"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSessionStatus, useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

interface ModelRatingProps {
	modelId: string;
}

export function ModelRating({ modelId }: ModelRatingProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { isAuthenticated } = useSessionStatus();
	const { user } = useUser({ enabled: isAuthenticated });

	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState(0);
	const [hovered, setHovered] = useState(0);
	const [comment, setComment] = useState("");

	const aggregateQuery = api.useQuery(
		"get",
		"/public/model-ratings",
		{ params: { query: { modelId } } },
		{ staleTime: 60 * 1000 },
	);

	const ownRatingQuery = api.useQuery(
		"get",
		"/model-ratings",
		{ params: { query: { modelId } } },
		{ enabled: !!user, retry: 0 },
	);

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/public/model-ratings", {
					params: { query: { modelId } },
				}).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/model-ratings", {
					params: { query: { modelId } },
				}).queryKey,
			}),
		]);
	};

	const saveRating = api.useMutation("post", "/model-ratings", {
		onSuccess: async () => {
			setEditing(false);
			await invalidate();
			toast({
				title: "Rating saved",
				description: "Thanks for rating this model!",
			});
		},
		onError: () => {
			toast({
				title: "Error",
				description: "Failed to save your rating.",
				variant: "destructive",
			});
		},
	});

	const removeRating = api.useMutation("delete", "/model-ratings", {
		onSuccess: async () => {
			setEditing(false);
			setSelected(0);
			setComment("");
			await invalidate();
			toast({ title: "Rating removed" });
		},
	});

	const aggregate = aggregateQuery.data;
	const ownRating = ownRatingQuery.data?.rating ?? null;
	const eligibility = ownRatingQuery.data?.eligibility ?? null;
	const canRate = !user || (eligibility?.canRate ?? false);

	const displayedStars =
		hovered ||
		(editing ? selected : (ownRating?.rating ?? aggregate?.averageRating ?? 0));

	const startEditing = (value: number) => {
		if (!user || !canRate) {
			return;
		}
		setSelected(value);
		if (!editing) {
			setComment(ownRating?.comment ?? "");
		}
		setEditing(true);
	};

	return (
		<div className="rounded-lg border border-border/60 p-4 max-w-xl">
			<div className="flex flex-wrap items-center gap-3">
				<div
					className="flex items-center gap-0.5"
					role="radiogroup"
					aria-label="Rate this model"
				>
					{[1, 2, 3, 4, 5].map((value) => (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={
								(editing ? selected : (ownRating?.rating ?? 0)) === value
							}
							aria-label={`${value} star${value === 1 ? "" : "s"}`}
							disabled={!user || !canRate}
							onClick={() => startEditing(value)}
							onMouseEnter={() => user && canRate && setHovered(value)}
							onMouseLeave={() => setHovered(0)}
							className={user && canRate ? "cursor-pointer" : "cursor-default"}
						>
							<Star
								className={`h-5 w-5 ${
									value <= Math.round(displayedStars)
										? "fill-yellow-500 text-yellow-500"
										: "text-muted-foreground/40"
								}`}
							/>
						</button>
					))}
				</div>
				{aggregate && aggregate.ratingCount > 0 ? (
					<span className="text-sm text-muted-foreground">
						{aggregate.averageRating?.toFixed(1)} ·{" "}
						{aggregate.ratingCount.toLocaleString()}{" "}
						{aggregate.ratingCount === 1 ? "rating" : "ratings"}
					</span>
				) : (
					<span className="text-sm text-muted-foreground">No ratings yet</span>
				)}
				{!user && (
					<Link
						href="/login"
						className="text-sm text-primary hover:underline ml-auto"
					>
						Sign in to rate
					</Link>
				)}
				{user && !canRate && eligibility && (
					<span className="text-sm text-muted-foreground ml-auto">
						Make {eligibility.minimumRequests} requests to rate (
						{eligibility.requestCount.toLocaleString()}/
						{eligibility.minimumRequests.toLocaleString()})
					</span>
				)}
				{user && canRate && ownRating && !editing && (
					<span className="text-sm text-muted-foreground ml-auto">
						You rated {ownRating.rating}/5
					</span>
				)}
			</div>
			{editing && (
				<div className="mt-3 space-y-3">
					<Textarea
						placeholder="Share your experience with this model (optional)"
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						maxLength={2000}
						rows={3}
					/>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							disabled={selected === 0 || saveRating.isPending}
							onClick={() =>
								saveRating.mutate({
									body: {
										modelId,
										rating: selected,
										comment: comment.trim() || undefined,
									},
								})
							}
						>
							{saveRating.isPending ? "Saving..." : "Save rating"}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								setEditing(false);
								setSelected(0);
							}}
						>
							Cancel
						</Button>
						{ownRating && (
							<Button
								size="sm"
								variant="ghost"
								className="text-destructive"
								disabled={removeRating.isPending}
								onClick={() =>
									removeRating.mutate({
										params: { query: { modelId } },
									})
								}
							>
								Remove
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
