"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useApi } from "@/lib/fetch-client";

const EMPTY_FAVORITES: string[] = [];

export function useFavoriteModels() {
	const api = useApi();
	const queryClient = useQueryClient();

	const { data } = api.useQuery("get", "/user/favorites", {});
	const favorites: string[] = useMemo(
		() => data?.favorites ?? EMPTY_FAVORITES,
		[data?.favorites],
	);

	const favoritesQueryKey = api.queryOptions(
		"get",
		"/user/favorites",
		{},
	).queryKey;

	const addMutation = api.useMutation("post", "/user/favorites", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
		},
	});

	const removeMutation = api.useMutation("delete", "/user/favorites", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: favoritesQueryKey });
		},
	});

	const isFavorite = useCallback(
		(modelId: string) => favorites.includes(modelId),
		[favorites],
	);

	const toggleFavorite = (modelId: string) => {
		if (isFavorite(modelId)) {
			removeMutation.mutate({ params: { query: { modelId } } });
		} else {
			addMutation.mutate({ body: { modelId } });
		}
	};

	return { favorites, isFavorite, toggleFavorite };
}
