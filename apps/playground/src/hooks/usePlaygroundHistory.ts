import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

type RealtimeHistoryDetail =
	paths["/playground/realtime-history/{id}"]["get"]["responses"][200]["content"]["application/json"];

export function useImageHistory(enabled = true, organizationId?: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/image-history",
		{ params: { query: organizationId ? { organizationId } : {} } },
		{ enabled },
	);
}

// Full item including base64 image data, fetched only when the item is
// actually viewed. Items are immutable apart from prompt renames (which
// invalidate this query), so the data never goes stale.
export function useImageHistoryItem(id: string | null) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/image-history/{id}",
		{ params: { path: { id: id ?? "" } } },
		{ enabled: !!id, staleTime: Infinity },
	);
}

export function useSaveImageHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("post", "/playground/image-history", {
		onSuccess: (data, variables) => {
			// Seed the detail cache from the request body so selecting the
			// just-saved item doesn't re-download images we already have.
			if (variables?.body) {
				queryClient.setQueryData(
					api.queryOptions("get", "/playground/image-history/{id}", {
						params: { path: { id: data.item.id } },
					}).queryKey,
					{
						item: {
							id: data.item.id,
							prompt: data.item.prompt,
							createdAt: data.item.createdAt,
							inputImages: variables.body.inputImages ?? null,
							models: variables.body.models,
						},
					},
				);
			}
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/image-history").queryKey,
			});
		},
	});
}

export function useRenameImageHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("patch", "/playground/image-history/{id}", {
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/image-history").queryKey,
			});
			const id = variables.params?.path?.id;
			if (id) {
				void queryClient.invalidateQueries({
					queryKey: api.queryOptions("get", "/playground/image-history/{id}", {
						params: { path: { id } },
					}).queryKey,
				});
			}
		},
	});
}

export function useDeleteImageHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("delete", "/playground/image-history/{id}", {
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/image-history").queryKey,
			});
			const id = variables.params?.path?.id;
			if (id) {
				queryClient.removeQueries({
					queryKey: api.queryOptions("get", "/playground/image-history/{id}", {
						params: { path: { id } },
					}).queryKey,
				});
			}
		},
	});
}

export function useAudioHistory(enabled = true, organizationId?: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/audio-history",
		{ params: { query: organizationId ? { organizationId } : {} } },
		{ enabled },
	);
}

export function useSaveAudioHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("post", "/playground/audio-history", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/audio-history").queryKey,
			});
		},
	});
}

export function useRenameAudioHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("patch", "/playground/audio-history/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/audio-history").queryKey,
			});
		},
	});
}

export function useDeleteAudioHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("delete", "/playground/audio-history/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/audio-history").queryKey,
			});
		},
	});
}

export function useRealtimeHistory(enabled = true, organizationId?: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/realtime-history",
		{ params: { query: organizationId ? { organizationId } : {} } },
		{ enabled },
	);
}

// Full call including its transcript, fetched only when a call is opened. The
// only writes are title renames and continued-call appends, both of which
// invalidate this query, so the data never goes stale.
export function useRealtimeHistoryItem(id: string | null) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/realtime-history/{id}",
		{ params: { path: { id: id ?? "" } } },
		{ enabled: !!id, staleTime: Infinity },
	);
}

export function useSaveRealtimeHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("post", "/playground/realtime-history", {
		onSuccess: (data, variables) => {
			// Seed the detail cache from the request body so opening the call
			// that just ended doesn't round-trip for a transcript we already have.
			if (variables?.body) {
				queryClient.setQueryData(
					api.queryOptions("get", "/playground/realtime-history/{id}", {
						params: { path: { id: data.item.id } },
					}).queryKey,
					{
						item: {
							...data.item,
							transcript: variables.body.transcript,
							usage: variables.body.usage ?? null,
						},
					},
				);
			}
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/realtime-history")
					.queryKey,
			});
		},
	});
}

// Renames a call and/or appends the turns of a continued session to it. Both
// change the detail payload, so it is invalidated alongside the list.
export function useUpdateRealtimeHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("patch", "/playground/realtime-history/{id}", {
		onSuccess: (data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/realtime-history")
					.queryKey,
			});
			const id = variables.params?.path?.id;
			if (!id) {
				return;
			}
			const detailKey = api.queryOptions(
				"get",
				"/playground/realtime-history/{id}",
				{ params: { path: { id } } },
			).queryKey;
			const appended = variables.body?.appendTranscript;
			// Fold the appended turns into the cached detail up front, so a call
			// that just ended reads complete the instant it is opened rather than
			// showing its pre-continuation transcript until the refetch lands.
			// The cache key is tagged as `{}` by openapi-react-query, so the shape
			// has to be reapplied on read.
			const previous = queryClient.getQueryData(detailKey) as
				RealtimeHistoryDetail | undefined;
			if (appended?.length && previous) {
				queryClient.setQueryData(detailKey, {
					item: {
						...previous.item,
						...data.item,
						transcript: [...previous.item.transcript, ...appended],
					},
				});
			}
			void queryClient.invalidateQueries({ queryKey: detailKey });
		},
	});
}

export function useDeleteRealtimeHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("delete", "/playground/realtime-history/{id}", {
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/realtime-history")
					.queryKey,
			});
			const id = variables.params?.path?.id;
			if (id) {
				queryClient.removeQueries({
					queryKey: api.queryOptions(
						"get",
						"/playground/realtime-history/{id}",
						{ params: { path: { id } } },
					).queryKey,
				});
			}
		},
	});
}

export function useVideoHistory(enabled = true, organizationId?: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/video-history",
		{ params: { query: organizationId ? { organizationId } : {} } },
		{ enabled },
	);
}

export function useSaveVideoHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("post", "/playground/video-history", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/video-history").queryKey,
			});
		},
	});
}

export function useRenameVideoHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("patch", "/playground/video-history/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/video-history").queryKey,
			});
		},
	});
}

export function useDeleteVideoHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("delete", "/playground/video-history/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/video-history").queryKey,
			});
		},
	});
}
