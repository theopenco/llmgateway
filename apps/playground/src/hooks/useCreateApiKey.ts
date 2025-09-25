import { useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";

import { useDefaultProject } from "@/hooks/useDefaultProject";
import { useApi } from "@/lib/fetch-client";

export function useCreateApiKey() {
	const queryClient = useQueryClient();
	const posthog = usePostHog();
	const { data: defaultProject } = useDefaultProject();
	const api = useApi();
	const { mutate: createApiKey } = api.useMutation("post", "/keys/api");

	const create = (name: string, onSuccess: (token: string) => void) => {
		if (!defaultProject?.id) {
			toast.error("No project available.", {
				style: {
					backgroundColor: "var(--destructive)",
					color: "var(--destructive-foreground)",
				},
			});
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
					toast.error("Failed to create API key.", {
						style: {
							backgroundColor: "var(--destructive)",
							color: "var(--destructive-foreground)",
						},
					});
				},
			},
		);
	};

	return { create };
}
