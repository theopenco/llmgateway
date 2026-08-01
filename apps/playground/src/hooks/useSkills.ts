"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useApi } from "@/lib/fetch-client";
import { getErrorMessage } from "@/lib/utils";

export const SKILL_NAME_MAX = 100;
export const SKILL_DESCRIPTION_MAX = 2000;

export interface Skill {
	id: string;
	name: string;
	description: string;
	instructions: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export function useSkills() {
	const api = useApi();
	return api.useQuery("get", "/skills", {});
}

export function useCreateSkill() {
	const api = useApi();
	const queryClient = useQueryClient();
	const skillsQueryKey = api.queryOptions("get", "/skills", {}).queryKey;

	return api.useMutation("post", "/skills", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: skillsQueryKey });
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useUpdateSkill() {
	const api = useApi();
	const queryClient = useQueryClient();
	const skillsQueryKey = api.queryOptions("get", "/skills", {}).queryKey;

	return api.useMutation("patch", "/skills/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: skillsQueryKey });
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}

export function useDeleteSkill() {
	const api = useApi();
	const queryClient = useQueryClient();
	const skillsQueryKey = api.queryOptions("get", "/skills", {}).queryKey;

	return api.useMutation("delete", "/skills/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: skillsQueryKey });
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
		},
	});
}
