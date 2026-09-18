import { useState } from "react";
import { Modal, Switch, Text, View } from "react-native";

import { Choice } from "@/components/Choice";
import { Button, ErrorNotice, Field, Screen, styles } from "@/components/ui";
import {
	chatSettingsFromFields,
	defaultChatSettings,
	reasoningEfforts,
	usePreferences,
} from "@/lib/preferences";

import type { ChatSettings as ChatSettingsValue } from "@/lib/preferences";

interface SettingsProps {
	onClose: () => void;
	webSearch?: boolean;
	onSaved?: (settings: ChatSettingsValue) => void;
}

function SettingsForm({ onClose, webSearch, onSaved }: SettingsProps) {
	const preferences = usePreferences();
	const initial = {
		...(preferences.data?.chat ?? defaultChatSettings),
		...(webSearch !== undefined && { webSearch }),
	};
	const [draft, setDraft] = useState(initial);
	const [temperature, setTemperature] = useState(
		initial.temperature?.toString() ?? "",
	);
	const [maxTokens, setMaxTokens] = useState(
		initial.maxTokens?.toString() ?? "",
	);
	const [error, setError] = useState<unknown>();
	const submit = () => {
		try {
			const settings = chatSettingsFromFields(draft, temperature, maxTokens);
			preferences.save.mutate(settings, {
				onSuccess: () => {
					onSaved?.(settings);
					onClose();
				},
			});
		} catch {
			setError(
				new Error(
					"Temperature must be between 0 and 2. Maximum tokens must be a positive whole number.",
				),
			);
		}
	};
	return (
		<Screen fullScreen>
			<Text style={styles.title}>Chat settings</Text>
			<Field
				label="System instructions"
				value={draft.systemPrompt}
				onChangeText={(systemPrompt) => setDraft({ ...draft, systemPrompt })}
				multiline
				style={{ minHeight: 110 }}
			/>
			<Field
				label="Temperature"
				value={temperature}
				onChangeText={setTemperature}
				placeholder="Model default"
				keyboardType="decimal-pad"
			/>
			<Field
				label="Maximum output tokens"
				value={maxTokens}
				onChangeText={setMaxTokens}
				placeholder="Model default"
				keyboardType="number-pad"
			/>
			<Choice
				label="Reasoning effort"
				value={draft.reasoningEffort}
				options={reasoningEfforts}
				onChange={(reasoningEffort) => setDraft({ ...draft, reasoningEffort })}
			/>
			<View style={styles.row}>
				<Text style={[styles.body, { flex: 1 }]}>Search the web</Text>
				<Switch
					testID="web-search-switch"
					accessibilityLabel="Search the web"
					value={draft.webSearch}
					onValueChange={(webSearch) => setDraft({ ...draft, webSearch })}
				/>
			</View>
			<Text style={styles.muted}>
				Available settings depend on the selected model. These preferences are
				saved on this device until you sign out.
			</Text>
			<ErrorNotice
				error={error ?? preferences.error ?? preferences.save.error}
			/>
			<Button
				title="Save settings"
				busy={preferences.save.isPending}
				onPress={submit}
			/>
			<Button
				title="Reset settings"
				secondary
				busy={preferences.save.isPending}
				onPress={() =>
					preferences.save.mutate(defaultChatSettings, {
						onSuccess: () => {
							onSaved?.(defaultChatSettings);
							onClose();
						},
					})
				}
			/>
			<Button title="Cancel" secondary onPress={onClose} />
		</Screen>
	);
}

export function ChatSettings({
	webSearch,
	onSaved,
}: Omit<SettingsProps, "onClose">) {
	const [open, setOpen] = useState(false);
	const preferences = usePreferences();
	return (
		<>
			<Button
				title="Chat settings"
				secondary
				disabled={preferences.isPending}
				onPress={() => setOpen(true)}
			/>
			<ErrorNotice error={preferences.error} />
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				{open && (
					<SettingsForm
						webSearch={webSearch}
						onSaved={onSaved}
						onClose={() => setOpen(false)}
					/>
				)}
			</Modal>
		</>
	);
}
