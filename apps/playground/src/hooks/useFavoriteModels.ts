"use client";

import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

export function useFavoriteModels() {
	const api = useApi();
	const queryClient = useQueryClient();

	const { data } = api.useQuery("get", "/user/favorites", {});
	const favorites: string[] = data?.favorites ?? [];

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

	const isFavorite = (modelId: string) => favorites.includes(modelId);

	const toggleFavorite = (modelId: string) => {
		if (isFavorite(modelId)) {
			removeMutation.mutate({ params: { query: { modelId } } });
		} else {
			addMutation.mutate({ body: { modelId } });
		}
	};

	return { favorites, isFavorite, toggleFavorite };
}
