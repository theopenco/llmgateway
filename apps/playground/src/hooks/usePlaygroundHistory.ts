import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

export function useImageHistory(enabled = true, organizationId?: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/playground/image-history",
		{ params: { query: organizationId ? { organizationId } : {} } },
		{ enabled },
	);
}

export function useSaveImageHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("post", "/playground/image-history", {
		onSuccess: () => {
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
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/image-history").queryKey,
			});
		},
	});
}

export function useDeleteImageHistory() {
	const queryClient = useQueryClient();
	const api = useApi();
	return api.useMutation("delete", "/playground/image-history/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/playground/image-history").queryKey,
			});
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
