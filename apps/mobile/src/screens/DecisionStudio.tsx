import Clipboard from "@react-native-clipboard/clipboard";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { api, client, queryClient } from "@/api/client";
import {
	acceptsImages,
	decisionCurl,
	decisionImage,
	runDecision,
} from "@/api/decisions";
import { Choice } from "@/components/Choice";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";
import { pickFile } from "@/lib/files";

import {
	convertDecisionQuestion,
	createDecisionQuestion,
	DECISION_QUESTION_TYPE_LABELS,
	decisionAnswerHeadline,
	decisionQuestionName,
	decisionScenarios,
	formatProbability,
	MAX_DECISION_CHOICES,
	MAX_DECISION_INPUT_IMAGES,
	MAX_DECISION_LEVELS,
	MAX_DECISION_MODELS,
	MAX_DECISION_QUESTIONS,
	validateDecisionQuestions,
} from "@llmgateway/shared/decision-studio";

import type { DecisionResult } from "@/api/decisions";
import type {
	DecisionAnswer,
	DecisionInputImage,
	DecisionQuestion,
	DecisionQuestionType,
} from "@llmgateway/shared/decision-studio";

interface Run {
	id?: string;
	prompt: string;
	title?: string | null;
	inputImages: DecisionInputImage[];
	questions: DecisionQuestion[];
	models: DecisionResult[];
}

const types = Object.keys(
	DECISION_QUESTION_TYPE_LABELS,
) as DecisionQuestionType[];

function Bar({ label, value }: { label: string; value: number }) {
	return (
		<View style={{ gap: 4 }}>
			<View style={[styles.row, { justifyContent: "space-between" }]}>
				<Text style={[styles.body, { flexShrink: 1 }]}>{label}</Text>
				<Text style={styles.muted}>{formatProbability(value)}</Text>
			</View>
			<View
				accessible
				accessibilityLabel={`${label}: ${formatProbability(value)}`}
				accessibilityRole="progressbar"
				accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
				style={{ height: 8, borderRadius: 4, backgroundColor: colors.border }}
			>
				<View
					style={{
						height: 8,
						borderRadius: 4,
						backgroundColor: colors.accent,
						width: `${Math.max(0, Math.min(1, value)) * 100}%`,
					}}
				/>
			</View>
		</View>
	);
}

function AnswerCard({
	answer,
	question,
	index,
}: {
	answer: DecisionAnswer;
	question?: DecisionQuestion;
	index: number;
}) {
	const name =
		answer.name ?? (question && decisionQuestionName(question, index));
	return (
		<View style={styles.card}>
			<Text style={styles.eyebrow}>{name?.toUpperCase()}</Text>
			{question && <Text style={styles.muted}>{question.instructions}</Text>}
			<Text style={styles.heading}>
				{decisionAnswerHeadline(answer, question)}
			</Text>
			{answer.type === "predicate" && answer.probability !== undefined && (
				<Bar label="Yes" value={answer.probability} />
			)}
			{answer.probabilities?.map((option, position) => (
				<Bar
					key={position}
					label={
						option.label ??
						(question?.type === "score" && typeof option.value === "number"
							? (question.levels[option.value]?.label ?? String(option.value))
							: String(option.value))
					}
					value={option.probability}
				/>
			))}
			{answer.confidence !== undefined && (
				<Text style={styles.muted}>
					Confidence {formatProbability(answer.confidence)}
				</Text>
			)}
		</View>
	);
}

function QuestionEditor({
	question,
	index,
	disabled,
	onChange,
	onRemove,
}: {
	question: DecisionQuestion;
	index: number;
	disabled: boolean;
	onChange: (question: DecisionQuestion) => void;
	onRemove?: () => void;
}) {
	const position = index + 1;
	return (
		<View style={styles.card}>
			<Text style={styles.eyebrow}>QUESTION {position}</Text>
			<Choice
				label={`Question ${position} type`}
				value={question.type}
				options={types}
				format={(type) => DECISION_QUESTION_TYPE_LABELS[type].label}
				disabled={disabled}
				onChange={(type) => onChange(convertDecisionQuestion(question, type))}
			/>
			<Text style={styles.muted}>
				{DECISION_QUESTION_TYPE_LABELS[question.type].description}
			</Text>
			<Field
				label={`Question ${position} name`}
				value={question.name}
				placeholder={`q${position}`}
				autoCapitalize="none"
				autoCorrect={false}
				editable={!disabled}
				onChangeText={(name) => onChange({ ...question, name })}
			/>
			<Field
				label={`Question ${position} instructions`}
				value={question.instructions}
				multiline
				editable={!disabled}
				onChangeText={(instructions) => onChange({ ...question, instructions })}
			/>
			{question.type === "choice" && (
				<>
					{question.choices.map((choice, option) => (
						<View key={option} style={{ gap: 8 }}>
							<Field
								label={`Question ${position} option ${option + 1}`}
								value={choice.value}
								autoCapitalize="none"
								editable={!disabled}
								onChangeText={(value) =>
									onChange({
										...question,
										choices: question.choices.map((entry, i) =>
											i === option ? { ...entry, value } : entry,
										),
									})
								}
							/>
							{question.choices.length > 2 && (
								<Button
									title={`Remove option ${option + 1}`}
									quiet
									disabled={disabled}
									onPress={() =>
										onChange({
											...question,
											choices: question.choices.filter((_, i) => i !== option),
										})
									}
								/>
							)}
						</View>
					))}
					{question.choices.length < MAX_DECISION_CHOICES && (
						<Button
							title="Add option"
							secondary
							disabled={disabled}
							onPress={() =>
								onChange({
									...question,
									choices: [...question.choices, { value: "" }],
								})
							}
						/>
					)}
				</>
			)}
			{question.type === "score" && (
				<>
					<Text style={styles.muted}>Levels, lowest first.</Text>
					{question.levels.map((level, option) => (
						<View key={option} style={{ gap: 8 }}>
							<Field
								label={`Question ${position} level ${option + 1}`}
								value={level.label}
								editable={!disabled}
								onChangeText={(label) =>
									onChange({
										...question,
										levels: question.levels.map((entry, i) =>
											i === option ? { ...entry, label } : entry,
										),
									})
								}
							/>
							{question.levels.length > 2 && (
								<Button
									title={`Remove level ${option + 1}`}
									quiet
									disabled={disabled}
									onPress={() =>
										onChange({
											...question,
											levels: question.levels.filter((_, i) => i !== option),
										})
									}
								/>
							)}
						</View>
					))}
					{question.levels.length < MAX_DECISION_LEVELS && (
						<Button
							title="Add level"
							secondary
							disabled={disabled}
							onPress={() =>
								onChange({
									...question,
									levels: [...question.levels, { label: "" }],
								})
							}
						/>
					)}
				</>
			)}
			{onRemove && (
				<Button
					title={`Remove question ${position}`}
					secondary
					disabled={disabled}
					onPress={onRemove}
				/>
			)}
		</View>
	);
}

export function DecisionStudio({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const [models, setModels] = useState([""]);
	const [input, setInput] = useState("");
	const [images, setImages] = useState<DecisionInputImage[]>([]);
	const [questions, setQuestions] = useState<DecisionQuestion[]>(() => [
		createDecisionQuestion("predicate"),
	]);
	const [run, setRun] = useState<Run>();
	const [selectedId, setSelectedId] = useState<string>();
	const [unsaved, setUnsaved] = useState(false);
	const [showJson, setShowJson] = useState(false);
	const [editing, setEditing] = useState(true);
	const [copied, setCopied] = useState<string>();
	const [search, setSearch] = useState("");
	const catalog = api.useQuery(
		"get",
		"/internal/models",
		{},
		{ staleTime: 300_000 },
	);
	const history = api.useQuery("get", "/playground/decision-history", {
		params: { query: { organizationId } },
	});
	const detail = api.useQuery(
		"get",
		"/playground/decision-history/{id}",
		{ params: { path: { id: selectedId ?? "" } } },
		{ enabled: Boolean(selectedId) },
	);
	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["get", "/playground/decision-history"],
		});
		await queryClient.invalidateQueries({
			queryKey: ["get", "/lounge/points/me"],
		});
	};
	const imagesAllowed =
		models.every(Boolean) &&
		models.every((model) => acceptsImages(model, catalog.data?.models ?? []));
	const problem =
		!input.trim() && !images.length
			? "Enter the text to evaluate."
			: validateDecisionQuestions(questions);
	const save = useMutation({
		mutationFn: async (value: Run) => {
			const { data } = await client.POST("/playground/decision-history", {
				body: {
					organizationId,
					prompt: value.prompt,
					inputImages: value.inputImages,
					questions: value.questions,
					models: value.models,
				},
			});
			setUnsaved(false);
			if (data?.item.id) {
				setRun((current) => current && { ...current, id: data.item.id });
			}
			await refresh();
		},
	});
	const generate = useMutation({
		mutationFn: async () => {
			if (models.some((model) => !model)) {
				throw new Error("Choose a decision model.");
			}
			if (problem) {
				throw new Error(problem);
			}
			if (images.length && !imagesAllowed) {
				throw new Error("Remove the images: a selected model reads text only.");
			}
			save.reset();
			setSelectedId(undefined);
			setShowJson(false);
			setEditing(false);
			const value: Run = {
				prompt: input.trim(),
				inputImages: images,
				questions,
				models: [],
			};
			setRun(value);
			const results = await Promise.all(
				models.map((model) =>
					runDecision(projectId, model, value.prompt, images, questions),
				),
			);
			const completed = { ...value, models: results };
			setRun(completed);
			if (results.some((result) => result.answers)) {
				setUnsaved(true);
				save.mutate(completed);
			}
		},
	});
	const attach = useMutation({
		mutationFn: async () => {
			const file = await pickFile([
				"public.png",
				"public.jpeg",
				"org.webmproject.webp",
				"com.compuserve.gif",
			]);
			if (file) {
				const image = decisionImage(file.base64, file.mimeType);
				setImages((current) => [...current, image]);
			}
		},
	});
	const remove = api.useMutation(
		"delete",
		"/playground/decision-history/{id}",
		{
			onSuccess: () => {
				setSelectedId(undefined);
				void refresh();
			},
		},
	);
	const rename = api.useMutation("patch", "/playground/decision-history/{id}", {
		onSuccess: async () => {
			await refresh();
			await queryClient.invalidateQueries({
				queryKey: ["get", "/playground/decision-history/{id}"],
			});
		},
	});
	const busy = generate.isPending || save.isPending;
	const saved = selectedId ? detail.data?.item : undefined;
	const display: Run | undefined = saved
		? {
				id: saved.id,
				prompt: saved.prompt,
				title: saved.title,
				inputImages: saved.inputImages ?? [],
				questions: saved.questions,
				models: saved.models,
			}
		: run;
	const load = (value: {
		prompt: string;
		questions: DecisionQuestion[];
		inputImages?: DecisionInputImage[];
	}) => {
		setInput(value.prompt);
		setQuestions(value.questions);
		setImages(value.inputImages ?? []);
		setEditing(false);
	};
	const copy = (text: string) => {
		Clipboard.setString(text);
		setCopied(text);
	};
	return (
		<Screen>
			<Text style={styles.eyebrow}>DECISION STUDIO</Text>
			<Text style={styles.title}>Ask typed questions.</Text>
			<Text style={styles.muted}>
				Get calibrated yes/no, pick-one and rating answers with a probability
				for every option. Compare up to {MAX_DECISION_MODELS} models. Decision
				models bill input tokens only.
			</Text>
			{models.map((model, index) => (
				<View key={index} style={{ gap: 10 }}>
					<ModelPicker
						value={model}
						output="decision"
						label={`Decision model ${index + 1}`}
						disabled={busy}
						onChange={(value) =>
							setModels((current) =>
								current.map((entry, position) =>
									position === index ? value : entry,
								),
							)
						}
					/>
					{index > 0 && (
						<Button
							title={`Remove decision model ${index + 1}`}
							secondary
							disabled={busy}
							onPress={() =>
								setModels((current) =>
									current.filter((_, position) => position !== index),
								)
							}
						/>
					)}
				</View>
			))}
			{models.length < MAX_DECISION_MODELS && (
				<Button
					title="Compare another decision model"
					secondary
					disabled={busy}
					onPress={() => setModels((current) => [...current, ""])}
				/>
			)}
			<Text style={styles.heading}>Start from an example</Text>
			<View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
				{decisionScenarios.map((scenario) => (
					<Button
						key={scenario.label}
						title={scenario.label}
						secondary
						disabled={busy}
						onPress={() => {
							setSelectedId(undefined);
							load({ prompt: scenario.input, questions: scenario.questions });
						}}
					/>
				))}
			</View>
			<Field
				label="Text to evaluate"
				value={input}
				onChangeText={setInput}
				editable={!busy}
				multiline
				style={{ minHeight: 110 }}
			/>
			{imagesAllowed && (
				<Button
					title="Add image"
					secondary
					busy={attach.isPending}
					disabled={busy || images.length >= MAX_DECISION_INPUT_IMAGES}
					onPress={() => attach.mutate()}
				/>
			)}
			{images.map((image, index) => (
				<View key={index} style={styles.card}>
					<Image
						accessibilityLabel={`Input image ${index + 1}`}
						source={{ uri: image.dataUrl }}
						style={{ height: 100 }}
						resizeMode="contain"
					/>
					<Button
						title={`Remove image ${index + 1}`}
						secondary
						disabled={busy}
						onPress={() =>
							setImages((current) => current.filter((_, i) => i !== index))
						}
					/>
				</View>
			))}
			{images.length > 0 && !imagesAllowed && (
				<ErrorNotice
					error={
						new Error("A selected model reads text only. Remove the images.")
					}
				/>
			)}
			<View style={[styles.row, { justifyContent: "space-between" }]}>
				<Text style={styles.heading}>Questions</Text>
				<Button
					title={editing ? "Done editing" : "Edit questions"}
					quiet
					disabled={busy}
					onPress={() => setEditing((value) => !value)}
				/>
			</View>
			{!editing &&
				questions.map((question, index) => (
					<View key={index} style={styles.card}>
						<Text style={styles.eyebrow}>
							{decisionQuestionName(question, index).toUpperCase()} ·{" "}
							{DECISION_QUESTION_TYPE_LABELS[question.type].label.toUpperCase()}
						</Text>
						<Text style={styles.body}>
							{question.instructions || "No instructions yet"}
						</Text>
						{question.type !== "predicate" && (
							<Text style={styles.muted}>
								{question.type === "choice"
									? question.choices.map((choice) => choice.value).join(" · ")
									: question.levels.map((level) => level.label).join(" · ")}
							</Text>
						)}
					</View>
				))}
			{editing &&
				questions.map((question, index) => (
					<QuestionEditor
						key={index}
						question={question}
						index={index}
						disabled={busy}
						onChange={(value) =>
							setQuestions((current) =>
								current.map((entry, i) => (i === index ? value : entry)),
							)
						}
						onRemove={
							questions.length > 1
								? () =>
										setQuestions((current) =>
											current.filter((_, i) => i !== index),
										)
								: undefined
						}
					/>
				))}
			{editing && questions.length < MAX_DECISION_QUESTIONS && (
				<Button
					title="Add question"
					secondary
					disabled={busy}
					onPress={() =>
						setQuestions((current) => [
							...current,
							createDecisionQuestion("predicate"),
						])
					}
				/>
			)}
			{problem && <Text style={styles.muted}>{problem}</Text>}
			<Button
				title={generate.isPending ? "Deciding…" : "Run decision"}
				disabled={
					busy ||
					unsaved ||
					Boolean(problem) ||
					models.some((model) => !model) ||
					(images.length > 0 && !imagesAllowed)
				}
				onPress={() => generate.mutate()}
			/>
			<ErrorNotice
				error={
					generate.error ??
					attach.error ??
					history.error ??
					detail.error ??
					remove.error ??
					rename.error
				}
			/>
			{save.error && run && (
				<View style={styles.card}>
					<Text style={styles.body}>
						Your answers are ready, but history could not be saved.
					</Text>
					<ErrorNotice error={save.error} />
					<Button
						title="Retry saving decision"
						busy={save.isPending}
						onPress={() => save.mutate(run)}
					/>
				</View>
			)}
			{generate.isPending && <Loading />}
			{selectedId && detail.isPending && <Loading />}
			{display && display.models.length > 0 && (
				<View style={{ gap: 14 }}>
					<Text style={styles.heading}>
						{display.title?.trim() || display.prompt || "Untitled run"}
					</Text>
					{display.models.map((result, modelIndex) => (
						<View key={`${result.modelId}-${modelIndex}`} style={{ gap: 10 }}>
							<Text style={[styles.body, { fontWeight: "600" }]}>
								{result.modelName}
							</Text>
							<ErrorNotice
								error={result.error ? new Error(result.error) : null}
							/>
							{result.answers?.map((answer, index) => (
								<AnswerCard
									key={index}
									answer={answer}
									question={display.questions[index]}
									index={index}
								/>
							))}
							{result.usage && (
								<Text style={styles.muted}>
									{result.usage.input_tokens} input tokens
								</Text>
							)}
							<Button
								title={
									copied ===
									decisionCurl(
										result.modelId,
										display.prompt,
										display.inputImages.length,
										display.questions,
									)
										? "cURL copied"
										: `Copy cURL for ${result.modelName}`
								}
								secondary
								onPress={() =>
									copy(
										decisionCurl(
											result.modelId,
											display.prompt,
											display.inputImages.length,
											display.questions,
										),
									)
								}
							/>
						</View>
					))}
					<Button
						title={showJson ? "Hide JSON" : "Show JSON"}
						secondary
						onPress={() => setShowJson((value) => !value)}
					/>
					{showJson && (
						<Text
							selectable
							style={[styles.muted, { fontFamily: "Menlo", fontSize: 12 }]}
						>
							{JSON.stringify(
								display.models.map((result) => ({
									model: result.modelId,
									answers: result.answers,
								})),
								null,
								2,
							)}
						</Text>
					)}
					<Button
						title="Edit this run"
						secondary
						disabled={busy}
						onPress={() => load(display)}
					/>
				</View>
			)}
			<Text style={styles.heading}>Decision history</Text>
			<Field label="Search decisions" value={search} onChangeText={setSearch} />
			{history.isPending && <Loading />}
			{history.data?.items
				.filter((item) =>
					`${item.title ?? ""} ${item.prompt}`
						.toLowerCase()
						.includes(search.toLowerCase()),
				)
				.map((item) => {
					const label = item.title?.trim() || item.prompt.slice(0, 80);
					return (
						<View key={item.id} style={styles.card}>
							<Button
								title={label || "Untitled run"}
								accessibilityLabel={`View decision: ${label}`}
								secondary
								onPress={() => {
									setSelectedId(item.id);
									setEditing(false);
								}}
							/>
							<Text style={styles.muted}>
								{new Date(item.createdAt).toLocaleString()} ·{" "}
								{item.questions.length} questions · {item.models.length} models
								{item.inputImageCount
									? ` · ${item.inputImageCount} images`
									: ""}
							</Text>
							<View style={styles.row}>
								<Button
									title="Rename decision"
									secondary
									onPress={() =>
										Alert.prompt(
											"Rename decision",
											undefined,
											(value) => {
												if (value.trim()) {
													rename.mutate({
														params: { path: { id: item.id } },
														body: { title: value.trim() },
													});
												}
											},
											"plain-text",
											item.title ?? "",
										)
									}
								/>
								<Button
									title="Delete decision"
									secondary
									onPress={() =>
										Alert.alert("Delete this decision run?", label, [
											{ text: "Cancel", style: "cancel" },
											{
												text: "Delete decision",
												style: "destructive",
												onPress: () =>
													remove.mutate({ params: { path: { id: item.id } } }),
											},
										])
									}
								/>
							</View>
						</View>
					);
				})}
		</Screen>
	);
}
