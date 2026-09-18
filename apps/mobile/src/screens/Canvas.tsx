import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	ActionSheetIOS,
	Alert,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useColorScheme } from "react-native";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";

import { generateCanvas } from "@/api/canvas";
import { CanvasPreview } from "@/components/CanvasPreview";
import { ModelPicker } from "@/components/ModelPicker";
import { Button, ErrorNotice, Field, Screen, styles } from "@/components/ui";
import { useCanvasModel } from "@/lib/canvas-model";
import { exportFile } from "@/lib/export-file";

import { validateCanvas } from "@llmgateway/canvas/spec";
import { templates } from "@llmgateway/canvas/templates";

import type { CanvasPreviewHandle } from "@/components/CanvasPreview";
import type { Spec } from "@llmgateway/canvas/spec";

export function Canvas({ projectId }: { projectId: string }) {
	const dark = useColorScheme() === "dark";
	const insets = useSafeAreaInsets();
	const model = useCanvasModel();
	const [prompt, setPrompt] = useState("");
	const [canvas, setCanvas] = useState<{ spec: Spec; revision: number }>();
	const [editor, setEditor] = useState("");
	const [editing, setEditing] = useState(false);
	const [controls, setControls] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const [editorError, setEditorError] = useState<Error | null>(null);
	const [stopped, setStopped] = useState(false);
	const previewRef = useRef<CanvasPreviewHandle>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const revisionRef = useRef(0);
	useEffect(() => () => controllerRef.current?.abort(), []);
	const apply = (spec: Spec) => {
		setCanvas({ spec, revision: ++revisionRef.current });
		setEditor(JSON.stringify(spec, null, 2));
		setError(null);
		setControls(false);
	};
	const generate = useMutation({
		mutationFn: async () => {
			if (controllerRef.current) {
				return;
			}
			Keyboard.dismiss();
			const request = new AbortController();
			controllerRef.current = request;
			setError(null);
			setStopped(false);
			try {
				await generateCanvas({
					projectId,
					model: model.data ?? "auto",
					prompt,
					signal: request.signal,
					onProgress: (text, spec) => {
						if (spec) {
							apply(spec);
						}
						setEditor(text);
					},
				});
			} catch (cause) {
				if (request.signal.aborted) {
					setStopped(true);
				} else {
					setError(
						cause instanceof Error
							? cause
							: new Error("Canvas generation failed."),
					);
				}
			} finally {
				controllerRef.current = null;
			}
		},
	});
	const exporting = useMutation({
		mutationFn: async ({
			format,
			action,
		}: {
			format: "png" | "pdf";
			action: "save" | "share";
		}) => {
			if (!previewRef.current) {
				throw new Error("Create a canvas before exporting.");
			}
			const base64 = await previewRef.current.export(format);
			await exportFile({ base64, name: `canvas.${format}` }, action);
		},
	});
	const busy = generate.isPending || exporting.isPending;
	const chooseTemplate = () =>
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title: "Canvas templates",
				options: ["Cancel", ...templates.map((item) => item.name)],
				cancelButtonIndex: 0,
			},
			(index) => {
				if (index > 0) {
					apply(validateCanvas(templates[index - 1].spec));
					setStopped(false);
				}
			},
		);
	const exportCanvas = () =>
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title: "Export canvas",
				options: ["Cancel", "Save PNG", "Save PDF", "Share PNG", "Share PDF"],
				cancelButtonIndex: 0,
			},
			(index) => {
				if (index > 0) {
					exporting.mutate({
						format: index % 2 ? "png" : "pdf",
						action: index <= 2 ? "save" : "share",
					});
				}
			},
		);
	const reset = () => {
		setCanvas(undefined);
		setEditor("");
		setPrompt("");
		setError(null);
		setStopped(false);
		setControls(true);
		exporting.reset();
	};
	return (
		<KeyboardAvoidingView
			style={styles.screen}
			behavior="padding"
			keyboardVerticalOffset={insets.top + 44}
		>
			<View style={{ padding: 12, gap: 8 }}>
				<ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
					<Button
						title="Prompt"
						secondary
						disabled={busy}
						onPress={() => setControls((value) => !value)}
					/>
					<Button
						title="Templates"
						secondary
						disabled={busy}
						onPress={chooseTemplate}
					/>
					<Button
						title="JSON"
						secondary
						disabled={busy || !editor}
						onPress={() => {
							setEditorError(null);
							setEditing(true);
						}}
					/>
					<Button
						title="Export"
						secondary
						disabled={busy || !canvas}
						onPress={exportCanvas}
					/>
					<Button
						title="New"
						secondary
						disabled={busy}
						onPress={() =>
							canvas
								? Alert.alert(
										"Reset canvas?",
										"This clears the current canvas and prompt.",
										[
											{ text: "Cancel", style: "cancel" },
											{
												text: "Reset canvas",
												style: "destructive",
												onPress: reset,
											},
										],
									)
								: reset()
						}
					/>
				</ScrollView>
				{controls && (
					<View style={{ gap: 8 }}>
						<ModelPicker
							value={model.data ?? "auto"}
							disabled={busy || model.save.isPending}
							onChange={(value) => model.save.mutate(value)}
						/>
						<Field
							label="Describe your canvas"
							value={prompt}
							onChangeText={setPrompt}
							multiline
							editable={!busy}
							style={{ minHeight: 85, maxHeight: 130 }}
						/>
						{!generate.isPending && (
							<Button
								title="Generate canvas"
								disabled={
									!prompt.trim() ||
									busy ||
									model.isPending ||
									model.isError ||
									model.save.isPending
								}
								onPress={() => generate.mutate()}
							/>
						)}
					</View>
				)}
				{generate.isPending && (
					<Button
						title="Stop generation"
						secondary
						onPress={() => controllerRef.current?.abort()}
					/>
				)}
				{stopped && (
					<Text style={styles.muted}>
						Generation stopped.
						{canvas ? " Your latest preview is still available." : ""}
					</Text>
				)}
				{exporting.isPending && (
					<Text style={styles.muted}>Exporting canvas…</Text>
				)}
				<ErrorNotice
					error={error ?? exporting.error ?? model.error ?? model.save.error}
				/>
			</View>
			{canvas ? (
				<CanvasPreview
					dark={dark}
					ref={previewRef}
					{...canvas}
					onError={setError}
				/>
			) : (
				<View
					style={{ flex: 1, padding: 24, justifyContent: "center", gap: 12 }}
				>
					<Text style={styles.heading}>No canvas yet</Text>
					<Text style={styles.body}>
						Describe an interface to build, or choose a template. Interact with
						the preview and export it as an image or PDF.
					</Text>
				</View>
			)}
			<View style={{ height: insets.bottom }} />
			<Modal
				visible={editing}
				animationType="slide"
				onRequestClose={() => setEditing(false)}
			>
				<SafeAreaProvider>
					<Screen fullScreen>
						<Text style={styles.heading}>Canvas JSON</Text>
						<Field
							label="Canvas JSON"
							value={editor}
							onChangeText={setEditor}
							multiline
							autoCorrect={false}
							autoCapitalize="none"
							style={{
								minHeight: 300,
								maxHeight: 420,
								fontFamily: "Menlo",
								fontSize: 12,
							}}
						/>
						<ErrorNotice error={editorError} />
						<Button
							title="Apply JSON"
							onPress={() => {
								try {
									apply(validateCanvas(JSON.parse(editor)));
									setEditing(false);
								} catch (cause) {
									setEditorError(
										cause instanceof Error
											? cause
											: new Error("Invalid canvas JSON."),
									);
								}
							}}
						/>
						<Button
							title="Close editor"
							secondary
							onPress={() => setEditing(false)}
						/>
					</Screen>
				</SafeAreaProvider>
			</Modal>
		</KeyboardAvoidingView>
	);
}
