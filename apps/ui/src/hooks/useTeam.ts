import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

export function useTeamMembers(organizationId: string) {
	const api = useApi();

	return api.useQuery("get", "/team/{organizationId}/members", {
		params: {
			path: {
				organizationId,
			},
		},
	});
}

export function useAddTeamMember(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation("post", "/team/{organizationId}/members", {
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: [
					"get",
					"/team/{organizationId}/members",
					{ params: { path: { organizationId } } },
				],
			});
		},
	});
}

export function useUpdateTeamMember(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation("patch", "/team/{organizationId}/members/{memberId}", {
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: [
					"get",
					"/team/{organizationId}/members",
					{ params: { path: { organizationId } } },
				],
			});
		},
	});
}

export function useRemoveTeamMember(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation(
		"delete",
		"/team/{organizationId}/members/{memberId}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: [
						"get",
						"/team/{organizationId}/members",
						{ params: { path: { organizationId } } },
					],
				});
			},
		},
	);
}
