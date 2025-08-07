import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";

import { useDefaultProject } from "@/hooks/useDefaultProject";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

export function useCreateApiKey() {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const { data: defaultProject } = useDefaultProject();
	const api = useApi();
	const { mutate: createApiKey } = api.useMutation("post", "/keys/api");

	const create = (name: string, onSuccess: (token: string) => void) => {
		if (!defaultProject?.id) {
			toast({ title: "No project available.", variant: "destructive" });
			return;
		}

		createApiKey(
			{
				body: {
					description: name,
					projectId: defaultProject.id,
					usageLimit: null,
				},
			},
			{
				onSuccess: (data) => {
					const createdKey = data.apiKey;

					const queryKey = api.queryOptions("get", "/keys/api", {
						params: { query: { projectId: defaultProject.id } },
					}).queryKey;

					void queryClient.invalidateQueries({ queryKey });

					posthog.capture("api_key_created", {
						description: createdKey.description,
						keyId: createdKey.id,
					});

					onSuccess(createdKey.token);
				},
				onError: () => {
					toast({ title: "Failed to create API key.", variant: "destructive" });
				},
			},
		);
	};

	return { create };
}
