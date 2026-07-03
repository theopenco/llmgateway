import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type TeamMembersData =
	paths["/team/{organizationId}/members"]["get"]["responses"][200]["content"]["application/json"];

export function useTeamMembers(
	organizationId: string,
	initialData?: TeamMembersData,
) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/team/{organizationId}/members",
		{
			params: {
				path: {
					organizationId,
				},
			},
		},
		initialData ? { initialData } : undefined,
	);
}

// The authenticated user's OWN budget/spend for an org (self-service, no admin
// gate) — so members can see the limits an admin has set on them.
export function useMyMemberBudget(organizationId: string) {
	const api = useApi();

	return api.useQuery(
		"get",
		"/team/{organizationId}/members/me",
		{
			params: {
				path: {
					organizationId,
				},
			},
		},
		{
			enabled: !!organizationId,
		},
	);
}

export function useAddTeamMember(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation("post", "/team/{organizationId}/members", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
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
			void queryClient.invalidateQueries({
				queryKey: [
					"get",
					"/team/{organizationId}/members",
					{ params: { path: { organizationId } } },
				],
			});
		},
	});
}

export function useUpdateMemberBudget(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation(
		"patch",
		"/team/{organizationId}/members/{memberId}/budget",
		{
			onSuccess: () => {
				void queryClient.invalidateQueries({
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

export function useUpdateDefaultDeveloperBudget(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation(
		"patch",
		"/team/{organizationId}/default-developer-budget",
		{
			onSuccess: () => {
				void queryClient.invalidateQueries({
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

export function useRemoveTeamMember(organizationId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return api.useMutation(
		"delete",
		"/team/{organizationId}/members/{memberId}",
		{
			onSuccess: () => {
				void queryClient.invalidateQueries({
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
