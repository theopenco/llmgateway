import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type OrganizationTeamsData =
	paths["/team/{organizationId}/teams"]["get"]["responses"][200]["content"]["application/json"];

export function useOrganizationTeams(organizationId: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/team/{organizationId}/teams",
		{ params: { path: { organizationId } } },
		{ enabled: !!organizationId },
	);
}

export function useOrganizationTeam(organizationId: string, teamId: string) {
	const api = useApi();
	return api.useQuery(
		"get",
		"/team/{organizationId}/teams/{teamId}",
		{ params: { path: { organizationId, teamId } } },
		{ enabled: !!organizationId && !!teamId },
	);
}

function useInvalidateTeamQueries() {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({
			queryKey: ["get", "/team/{organizationId}/teams"],
		});
		void queryClient.invalidateQueries({
			queryKey: ["get", "/team/{organizationId}/teams/{teamId}"],
		});
		void queryClient.invalidateQueries({
			queryKey: ["get", "/team/{organizationId}/members"],
		});
	};
}

export function useCreateOrganizationTeam(_organizationId: string) {
	const api = useApi();
	return api.useMutation("post", "/team/{organizationId}/teams", {
		onSuccess: useInvalidateTeamQueries(),
	});
}

export function useUpdateOrganizationTeam(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation("patch", "/team/{organizationId}/teams/{teamId}", {
		onSuccess: useInvalidateTeamQueries(),
	});
}

export function useDeleteOrganizationTeam(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation("delete", "/team/{organizationId}/teams/{teamId}", {
		onSuccess: useInvalidateTeamQueries(),
	});
}

export function useUpdateOrganizationTeamProjects(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation(
		"put",
		"/team/{organizationId}/teams/{teamId}/projects",
		{
			onSuccess: useInvalidateTeamQueries(),
		},
	);
}

export function useUpdateOrganizationTeamBudget(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation(
		"put",
		"/team/{organizationId}/teams/{teamId}/budget",
		{
			onSuccess: useInvalidateTeamQueries(),
		},
	);
}

export function useAssignOrganizationTeam(_organizationId: string) {
	const api = useApi();
	return api.useMutation(
		"put",
		"/team/{organizationId}/members/{memberId}/team",
		{
			onSuccess: useInvalidateTeamQueries(),
		},
	);
}

export function useCreateOrganizationTeamIamRule(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation("post", "/team/{organizationId}/teams/{teamId}/iam", {
		onSuccess: useInvalidateTeamQueries(),
	});
}

export function useDeleteOrganizationTeamIamRule(
	_organizationId: string,
	_teamId: string,
) {
	const api = useApi();
	return api.useMutation(
		"delete",
		"/team/{organizationId}/teams/{teamId}/iam/{ruleId}",
		{
			onSuccess: useInvalidateTeamQueries(),
		},
	);
}
