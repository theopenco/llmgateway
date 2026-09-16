import { useMutation, useQuery } from "@tanstack/react-query";
import * as Keychain from "react-native-keychain";
import { z } from "zod";

import { queryClient } from "@/api/client";

export const reasoningEfforts = [
	"auto",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
const chatSettingsSchema = z.object({
	systemPrompt: z.string().default(""),
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().int().positive().optional(),
	reasoningEffort: z.enum(reasoningEfforts).default("auto"),
	webSearch: z.boolean().default(false),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
const preferencesSchema = z.object({ chat: chatSettingsSchema.default({}) });
const service = "io.llmgateway.lounge.preferences";
const queryKey = ["preferences"];
export const defaultChatSettings = chatSettingsSchema.parse({});

export async function loadPreferences() {
	const saved = await Keychain.getGenericPassword({ service });
	return preferencesSchema.parse(saved ? JSON.parse(saved.password) : {});
}

export async function saveChatSettings(settings: ChatSettings) {
	const preferences = preferencesSchema.parse({ chat: settings });
	await Keychain.setGenericPassword(
		"preferences",
		JSON.stringify(preferences),
		{
			service,
			accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
		},
	);
	queryClient.setQueryData(queryKey, preferences);
}

export async function clearPreferences() {
	await Keychain.resetGenericPassword({ service });
}

export function usePreferences() {
	const preferences = useQuery({
		queryKey,
		queryFn: loadPreferences,
		staleTime: Infinity,
	});
	const save = useMutation({ mutationFn: saveChatSettings });
	return { ...preferences, save };
}

export function chatSettingsFromFields(
	settings: ChatSettings,
	temperature: string,
	maxTokens: string,
) {
	return chatSettingsSchema.parse({
		...settings,
		temperature: temperature.trim() ? Number(temperature) : undefined,
		maxTokens: maxTokens.trim() ? Number(maxTokens) : undefined,
	});
}
