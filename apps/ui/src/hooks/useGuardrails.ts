import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useFetchClient } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type GuardrailConfig = NonNullable<
	paths["/guardrails/config/{organizationId}"]["get"]["responses"][200]["content"]["application/json"]
>;

export type GuardrailRule =
	paths["/guardrails/rules/{organizationId}"]["get"]["responses"][200]["content"]["application/json"]["rules"][number];

export type GuardrailRuleInput = NonNullable<
	paths["/guardrails/rules/{organizationId}"]["post"]["requestBody"]
>["content"]["application/json"];

export type GuardrailConfigInput = NonNullable<
	paths["/guardrails/projects/{projectId}/config"]["put"]["requestBody"]
>["content"]["application/json"];

/**
 * Guardrails are configured on the organization and, optionally, overridden per
 * project. Both scopes share the same settings surface, so the hooks below take
 * a scope and route to the matching endpoints.
 */
export type GuardrailsScope =
	| { kind: "organization"; organizationId: string }
	| { kind: "project"; organizationId: string; projectId: string };

function scopeKey(scope: GuardrailsScope) {
	return scope.kind === "project"
		? ["guardrails", "project", scope.projectId]
		: ["guardrails", "organization", scope.organizationId];
}

type FetchClient = ReturnType<typeof useFetchClient>;

export function useGuardrailConfig(
	scope: GuardrailsScope,
	options?: { enabled?: boolean },
) {
	const fetchClient = useFetchClient();

	return useQuery({
		queryKey: [...scopeKey(scope), "config"],
		enabled: options?.enabled ?? true,
		queryFn: async () => {
			const { data, error } =
				scope.kind === "project"
					? await fetchClient.GET("/guardrails/projects/{projectId}/config", {
							params: { path: { projectId: scope.projectId } },
						})
					: await fetchClient.GET("/guardrails/config/{organizationId}", {
							params: {
								path: { organizationId: scope.organizationId },
							},
						});

			if (error) {
				throw new Error("Failed to load guardrails configuration");
			}

			// A scope with no row yet returns a 200 with a null body.
			return (data ?? null) as GuardrailConfig | null;
		},
	});
}

export function useGuardrailRules(
	scope: GuardrailsScope,
	options?: { enabled?: boolean },
) {
	const fetchClient = useFetchClient();

	return useQuery({
		queryKey: [...scopeKey(scope), "rules"],
		enabled: options?.enabled ?? true,
		queryFn: async () => {
			const { data, error } =
				scope.kind === "project"
					? await fetchClient.GET("/guardrails/projects/{projectId}/rules", {
							params: { path: { projectId: scope.projectId } },
						})
					: await fetchClient.GET("/guardrails/rules/{organizationId}", {
							params: {
								path: { organizationId: scope.organizationId },
							},
						});

			if (error) {
				throw new Error("Failed to load guardrail rules");
			}

			return (data?.rules ?? []) as GuardrailRule[];
		},
	});
}

export function useProjectGuardrailOverrides(
	organizationId: string,
	options?: { enabled?: boolean },
) {
	const fetchClient = useFetchClient();

	return useQuery({
		queryKey: ["guardrails", "organization", organizationId, "overrides"],
		enabled: options?.enabled ?? true,
		queryFn: async () => {
			const { data, error } = await fetchClient.GET(
				"/guardrails/config/{organizationId}/project-overrides",
				{ params: { path: { organizationId } } },
			);

			if (error) {
				throw new Error("Failed to load project overrides");
			}

			return data.projects;
		},
	});
}

function saveConfig(
	fetchClient: FetchClient,
	scope: GuardrailsScope,
	body: GuardrailConfigInput,
) {
	return scope.kind === "project"
		? fetchClient.PUT("/guardrails/projects/{projectId}/config", {
				params: { path: { projectId: scope.projectId } },
				body,
			})
		: fetchClient.PUT("/guardrails/config/{organizationId}", {
				params: { path: { organizationId: scope.organizationId } },
				body,
			});
}

export function useSaveGuardrailConfig(scope: GuardrailsScope) {
	const fetchClient = useFetchClient();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: GuardrailConfigInput) => {
			const { error } = await saveConfig(fetchClient, scope, body);
			if (error) {
				throw new Error("Failed to save configuration");
			}
		},
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["guardrails"] }),
	});
}

export function useCreateGuardrailRule(scope: GuardrailsScope) {
	const fetchClient = useFetchClient();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: GuardrailRuleInput) => {
			const { data, error } =
				scope.kind === "project"
					? await fetchClient.POST("/guardrails/projects/{projectId}/rules", {
							params: { path: { projectId: scope.projectId } },
							body,
						})
					: await fetchClient.POST("/guardrails/rules/{organizationId}", {
							params: {
								path: { organizationId: scope.organizationId },
							},
							body,
						});

			if (error || !data) {
				throw new Error("Failed to add rule");
			}

			return data as GuardrailRule;
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: [...scopeKey(scope), "rules"],
			}),
	});
}

export function useUpdateGuardrailRule(scope: GuardrailsScope) {
	const fetchClient = useFetchClient();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			ruleId,
			...body
		}: { ruleId: string } & NonNullable<
			paths["/guardrails/rules/{organizationId}/{ruleId}"]["patch"]["requestBody"]
		>["content"]["application/json"]) => {
			const { error } =
				scope.kind === "project"
					? await fetchClient.PATCH(
							"/guardrails/projects/{projectId}/rules/{ruleId}",
							{
								params: { path: { projectId: scope.projectId, ruleId } },
								body,
							},
						)
					: await fetchClient.PATCH(
							"/guardrails/rules/{organizationId}/{ruleId}",
							{
								params: {
									path: { organizationId: scope.organizationId, ruleId },
								},
								body,
							},
						);

			if (error) {
				throw new Error("Failed to update rule");
			}
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: [...scopeKey(scope), "rules"],
			}),
	});
}

export function useDeleteGuardrailRule(scope: GuardrailsScope) {
	const fetchClient = useFetchClient();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (ruleId: string) => {
			const { error } =
				scope.kind === "project"
					? await fetchClient.DELETE(
							"/guardrails/projects/{projectId}/rules/{ruleId}",
							{ params: { path: { projectId: scope.projectId, ruleId } } },
						)
					: await fetchClient.DELETE(
							"/guardrails/rules/{organizationId}/{ruleId}",
							{
								params: {
									path: { organizationId: scope.organizationId, ruleId },
								},
							},
						);

			if (error) {
				throw new Error("Failed to delete rule");
			}
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: [...scopeKey(scope), "rules"],
			}),
	});
}
