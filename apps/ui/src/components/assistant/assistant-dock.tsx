"use client";

import { Chat, useChat } from "@ai-sdk/react";
import {
	DefaultChatTransport,
	lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { Decimal } from "decimal.js";
import {
	ArrowUp,
	Check,
	Copy,
	Loader2,
	Mic,
	RotateCcw,
	ShieldAlert,
	Square,
	Volume2,
	VolumeX,
	X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	AssistantApprovalDialog,
	type PendingApproval,
} from "@/components/assistant/assistant-approval-dialog";
import { AssistantSpotlight } from "@/components/assistant/assistant-spotlight";
import {
	revealStore,
	useAssistantReveal,
} from "@/components/assistant/assistant-store";
import { useDashboardTools } from "@/components/assistant/use-dashboard-tools";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { getApiErrorMessage } from "@/lib/api-error";
import { recentMessages, settleToolCalls } from "@/lib/assistant-messages";
import { useAppConfig } from "@/lib/config";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useFetchClient } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";
import { cn } from "@/lib/utils";
import { getModelContext } from "@/lib/webmcp";

import "./assistant.css";

import type { Organization, Project } from "@/lib/types";
import type { DynamicToolUIPart, UIMessage } from "ai";

const SUGGESTIONS = [
	"Where do I create an API key?",
	"Create an API key called Production",
	"Show me where I add credits",
];
const STATUS_LABEL = {
	idle: "Ready",
	listening: "Listening",
	transcribing: "Transcribing",
	thinking: "Thinking",
	acting: "Working",
	approval: "Needs approval",
	error: "Check the message",
} as const;

type DockStatus = keyof typeof STATUS_LABEL;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Failed HTTP responses surface the raw `{ "message": "..." }` body.
function chatErrorMessage(error: Error): string {
	const fallback = "The assistant is unavailable right now. Try again.";
	const message = error.message.trim();
	if (error instanceof TypeError || !message) {
		return fallback;
	}
	if (!message.startsWith("{") && !message.startsWith("<")) {
		return message;
	}
	try {
		return getApiErrorMessage(JSON.parse(message), fallback);
	} catch {
		return fallback;
	}
}

function toolSummary(part: DynamicToolUIPart, title: string): string {
	const input = isRecord(part.input) ? part.input : {};
	const subject = [input.page, input.label, input.name].find(
		(value): value is string => typeof value === "string",
	);
	return subject ? `${title} · ${subject}` : title;
}

function ToolChip({ part, title }: { part: DynamicToolUIPart; title: string }) {
	const failed = part.state === "output-error";
	const done = part.state === "output-available";
	return (
		<div
			data-testid="assistant-tool-chip"
			data-tool={part.toolName}
			data-state={part.state}
			className={cn(
				"inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide",
				failed
					? "border-rose-400/30 bg-rose-400/10 text-rose-200"
					: done
						? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
						: "border-white/15 bg-white/5 text-white/70",
			)}
		>
			{failed ? (
				<X className="size-3 shrink-0" aria-hidden />
			) : done ? (
				<Check className="size-3 shrink-0" aria-hidden />
			) : (
				<Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
			)}
			<span className="truncate">{toolSummary(part, title)}</span>
			{failed && part.errorText && (
				<span className="truncate text-rose-200/70">— {part.errorText}</span>
			)}
		</div>
	);
}

function Waveform({ levels }: { levels: number[] }) {
	const bars = Array.from({ length: 36 }, (_, index) => {
		const level = levels[levels.length - 36 + index] ?? 0;
		return Math.max(0.08, level);
	});
	return (
		<div
			className="flex h-10 flex-1 items-center justify-center gap-[3px] px-2"
			aria-hidden
		>
			{bars.map((level, index) => (
				<span
					key={index}
					className="w-[3px] rounded-full bg-[var(--assistant-glow)] transition-[height] duration-75"
					style={{ height: `${Math.round(level * 100)}%` }}
				/>
			))}
		</div>
	);
}

function AssistantPanel({
	organization,
	project,
	active,
	onClose,
}: {
	organization: Organization;
	project: Project;
	active: boolean;
	onClose: () => void;
}) {
	const { apiUrl } = useAppConfig();
	const fetchClient = useFetchClient();
	const reveal = useAssistantReveal();
	const [input, setInput] = useState("");
	const [approvals, setApprovals] = useState<PendingApproval[]>([]);
	const [running, setRunning] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);
	const [speakReplies, setSpeakReplies] = useState(true);
	const [copied, setCopied] = useState(false);
	const toolTitles = useRef(new Map<string, string>());
	const spokeLast = useRef(false);
	const spokenMessageId = useRef<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const chatRef = useRef<Chat<UIMessage> | null>(null);
	// Bumped on stop and reset, so work started before then reports nothing.
	const generation = useRef(0);

	const scope = useRef({ organization, project });
	useEffect(() => {
		scope.current = { organization, project };
	});

	const execute = useCallback((approval: PendingApproval) => {
		const startedIn = generation.current;
		const current = () => generation.current === startedIn;
		setRunning((count) => count + 1);
		getModelContext()
			.executeTool(approval.tool, approval.input)
			.then(
				(output) =>
					current() &&
					chatRef.current?.addToolOutput({
						tool: approval.tool.name,
						toolCallId: approval.toolCallId,
						output: JSON.parse(output),
					}),
			)
			.catch(
				(error: unknown) =>
					current() &&
					chatRef.current?.addToolOutput({
						state: "output-error",
						tool: approval.tool.name,
						toolCallId: approval.toolCallId,
						errorText:
							error instanceof Error && error.message
								? error.message
								: "The action failed.",
					}),
			)
			.finally(() => setRunning((count) => count - 1));
	}, []);

	const chat = useMemo(
		() =>
			new Chat<UIMessage>({
				transport: new DefaultChatTransport({
					api: `${apiUrl}/assistant/chat`,
					credentials: "include",
					// Tools are read per request: they change as pages mount.
					prepareSendMessagesRequest: async ({ messages }) => {
						const tools = await getModelContext().getTools();
						// Titles outlive their page, for chips of earlier steps.
						for (const tool of tools) {
							toolTitles.current.set(tool.name, tool.title);
						}
						return {
							body: {
								organizationId: scope.current.organization.id,
								projectId: scope.current.project.id,
								messages: recentMessages(messages),
								tools: tools.map((tool) => ({
									name: tool.name,
									description: tool.description,
									...(tool.inputSchema && { inputSchema: tool.inputSchema }),
								})),
								context: {
									path: window.location.pathname,
									organizationName: scope.current.organization.name,
									projectName: scope.current.project.name,
								},
							},
						};
					},
				}),
				sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
				onToolCall: async ({ toolCall }) => {
					const startedIn = generation.current;
					const tools = await getModelContext().getTools();
					if (generation.current !== startedIn) {
						return;
					}
					const tool = tools.find(
						(candidate) => candidate.name === toolCall.toolName,
					);
					if (!tool) {
						void chatRef.current?.addToolOutput({
							state: "output-error",
							tool: toolCall.toolName,
							toolCallId: toolCall.toolCallId,
							errorText: "This action is not available on the current page.",
						});
						return;
					}
					const approval: PendingApproval = {
						tool,
						toolCallId: toolCall.toolCallId,
						input: isRecord(toolCall.input) ? toolCall.input : {},
					};
					// Only tools that declare themselves read-only run unattended.
					if (tool.annotations?.readOnlyHint === true) {
						execute(approval);
					} else {
						setApprovals((queue) => [...queue, approval]);
					}
				},
			}),
		[apiUrl, execute],
	);
	useEffect(() => {
		chatRef.current = chat;
	}, [chat]);

	const {
		messages,
		sendMessage,
		status,
		error,
		stop,
		setMessages,
		clearError,
	} = useChat({ chat });

	const busy = status === "submitted" || status === "streaming";
	const occupied = busy || running > 0 || approvals.length > 0;

	const submit = (text: string, spoken = false) => {
		const prompt = text.trim();
		if (!prompt) {
			return;
		}
		// One turn at a time: a second request would race the open tool calls.
		if (occupied) {
			if (spoken) {
				setNotice("Finish the current step, then ask again.");
			}
			return;
		}
		spokeLast.current = spoken;
		setNotice(null);
		clearError();
		setInput("");
		setMessages((current) => settleToolCalls(current, "Interrupted."));
		void sendMessage({ text: prompt });
	};

	// Stops the turn and closes whatever it left open.
	const halt = () => {
		generation.current += 1;
		setApprovals([]);
		void stop().then(() =>
			setMessages((current) =>
				settleToolCalls(current, "Stopped by the user."),
			),
		);
	};

	const voice = useVoiceInput({
		transcribe: async (audio, mimeType) => {
			const { data, error: transcribeError } = await fetchClient.POST(
				"/assistant/transcribe",
				{
					body: {
						organizationId: organization.id,
						projectId: project.id,
						audio,
						mimeType,
					},
				},
			);
			if (transcribeError) {
				throw new Error(
					getApiErrorMessage(
						transcribeError,
						"Could not transcribe the recording.",
					),
				);
			}
			return data.text;
		},
		onTranscript: (text) => submit(text, true),
		onError: setNotice,
	});

	const dockStatus: DockStatus =
		voice.state === "recording"
			? "listening"
			: voice.state === "transcribing"
				? "transcribing"
				: approvals.length > 0
					? "approval"
					: running > 0
						? "acting"
						: busy
							? "thinking"
							: error || notice
								? "error"
								: "idle";

	useEffect(() => {
		if (active) {
			inputRef.current?.focus();
		}
	}, [active]);

	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [messages, reveal, error, notice]);

	// Spoken prompts get spoken answers.
	useEffect(() => {
		const last = messages.at(-1);
		if (
			status !== "ready" ||
			!last ||
			last.role !== "assistant" ||
			!spokeLast.current ||
			!speakReplies ||
			spokenMessageId.current === last.id ||
			!("speechSynthesis" in window)
		) {
			return;
		}
		const text = last.parts
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join(" ")
			.trim();
		if (!text || approvals.length > 0 || running > 0) {
			return;
		}
		spokenMessageId.current = last.id;
		window.speechSynthesis.cancel();
		window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
	}, [messages, status, speakReplies, approvals.length, running]);

	useEffect(
		() => () => {
			if ("speechSynthesis" in window) {
				window.speechSynthesis.cancel();
			}
		},
		[],
	);

	const resolveApproval = (approval: PendingApproval, approved: boolean) => {
		setApprovals((queue) => queue.filter((entry) => entry !== approval));
		if (approved) {
			execute(approval);
			return;
		}
		void chat.addToolOutput({
			state: "output-error",
			tool: approval.tool.name,
			toolCallId: approval.toolCallId,
			errorText: "The user declined this change.",
		});
	};

	const reset = () => {
		generation.current += 1;
		void stop().then(() => setMessages([]));
		setMessages([]);
		setApprovals([]);
		setNotice(null);
		clearError();
		revealStore.set(null);
	};

	const copySecret = async (secret: string) => {
		await navigator.clipboard.writeText(secret);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1600);
	};

	const recording = voice.state === "recording";
	const stoppable = busy || running > 0;
	const errorText = error ? chatErrorMessage(error) : notice;

	return (
		<div
			data-testid="assistant-dock"
			data-state={dockStatus === "transcribing" ? "thinking" : dockStatus}
			className="assistant-dock assistant-rise relative w-full"
		>
			<div className="assistant-glow" aria-hidden />
			<section
				aria-label="Autopilot assistant"
				className="assistant-panel flex flex-col rounded-[26px] text-white"
			>
				<header className="flex items-center gap-2 px-4 pt-3 pb-1">
					<span className="assistant-orb size-2.5 rounded-full" aria-hidden />
					<span className="font-mono text-[11px] font-semibold tracking-[0.22em] uppercase">
						Autopilot
					</span>
					<span
						role="status"
						data-testid="assistant-status"
						className="font-mono text-[11px] tracking-[0.14em] text-[var(--assistant-glow)] uppercase"
					>
						{STATUS_LABEL[dockStatus]}
					</span>
					<span className="ml-auto truncate font-mono text-[10px] tracking-wide text-white/40">
						{project.name}
					</span>
					<button
						type="button"
						onClick={() => {
							setSpeakReplies((value) => !value);
							window.speechSynthesis?.cancel();
						}}
						aria-label={
							speakReplies ? "Mute spoken replies" : "Speak replies aloud"
						}
						aria-pressed={speakReplies}
						className="grid size-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
					>
						{speakReplies ? (
							<Volume2 className="size-4" aria-hidden />
						) : (
							<VolumeX className="size-4" aria-hidden />
						)}
					</button>
					<button
						type="button"
						onClick={reset}
						aria-label="Start over"
						className="grid size-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
					>
						<RotateCcw className="size-4" aria-hidden />
					</button>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close Autopilot"
						className="grid size-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
					>
						<X className="size-4" aria-hidden />
					</button>
				</header>

				<div className="h-px overflow-hidden px-4">
					{(busy || running > 0 || voice.state === "transcribing") && (
						<div className="assistant-thinking-bar h-px w-full" />
					)}
				</div>

				<div
					ref={scrollRef}
					data-testid="assistant-transcript"
					aria-live="polite"
					className="flex max-h-[min(38vh,320px)] flex-col gap-2.5 overflow-y-auto px-4 py-3 text-[15px] leading-relaxed"
				>
					{messages.length === 0 && !errorText && (
						<div className="flex flex-col gap-2.5">
							<p className="text-white/55">
								Ask where something lives, or tell me to do it. I ask before I
								change anything.
							</p>
							<div className="flex flex-wrap gap-1.5">
								{SUGGESTIONS.map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										disabled={voice.state !== "idle"}
										onClick={() => submit(suggestion)}
										className="min-h-9 rounded-full border border-white/12 bg-white/5 px-3 text-[13px] text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
									>
										{suggestion}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((message) =>
						message.role === "user" ? (
							<p
								key={message.id}
								data-testid="assistant-user-message"
								className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-white/10 px-3 py-1.5 text-white/90"
							>
								{message.parts
									.filter((part) => part.type === "text")
									.map((part) => part.text)
									.join(" ")}
							</p>
						) : (
							<div
								key={message.id}
								className="flex flex-col items-start gap-1.5"
							>
								{message.parts.map((part, index) =>
									part.type === "dynamic-tool" ? (
										<ToolChip
											key={part.toolCallId}
											part={part}
											title={
												toolTitles.current.get(part.toolName) ?? part.toolName
											}
										/>
									) : part.type === "text" && part.text.trim() ? (
										<p
											key={index}
											data-testid="assistant-reply"
											className="max-w-[92%] text-white"
										>
											{part.text}
										</p>
									) : null,
								)}
							</div>
						),
					)}
					{reveal && (
						<div
							data-testid="assistant-reveal"
							className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-3"
						>
							<div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-emerald-200 uppercase">
								<ShieldAlert className="size-3.5" aria-hidden />
								{reveal.title} · shown once
							</div>
							<div className="flex items-center gap-2">
								<code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-2.5 py-2 font-mono text-xs text-white select-all">
									{reveal.secret}
								</code>
								<button
									type="button"
									onClick={() => void copySecret(reveal.secret)}
									className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-black transition hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
								>
									{copied ? (
										<Check className="size-3.5" aria-hidden />
									) : (
										<Copy className="size-3.5" aria-hidden />
									)}
									{copied ? "Copied" : "Copy"}
								</button>
								<button
									type="button"
									onClick={() => revealStore.set(null)}
									aria-label="Hide the secret"
									className="grid size-9 place-items-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
								>
									<X className="size-4" aria-hidden />
								</button>
							</div>
						</div>
					)}
					{errorText && (
						<p
							role="alert"
							data-testid="assistant-error"
							className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100"
						>
							{errorText}
						</p>
					)}
				</div>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (voice.state === "idle") {
							submit(input);
						}
					}}
					className="flex items-center gap-2 p-2.5 pt-1"
				>
					<button
						type="button"
						data-testid="assistant-mic"
						onClick={() => {
							if (recording) {
								voice.stop();
							} else if (!voice.supported) {
								setNotice("This browser cannot record audio.");
							} else {
								window.speechSynthesis?.cancel();
								void voice.start();
							}
						}}
						disabled={
							voice.state === "transcribing" || (occupied && !recording)
						}
						aria-label={recording ? "Stop recording" : "Talk to Autopilot"}
						aria-pressed={recording}
						className={cn(
							"grid size-11 shrink-0 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:opacity-40",
							recording
								? "bg-[var(--assistant-glow)] text-black shadow-[0_0_24px_var(--assistant-glow)]"
								: "bg-white/10 text-white hover:bg-white/20",
						)}
					>
						{recording ? (
							<Square className="size-4 fill-current" aria-hidden />
						) : voice.state === "transcribing" ? (
							<Loader2 className="size-5 animate-spin" aria-hidden />
						) : (
							<Mic className="size-5" aria-hidden />
						)}
					</button>
					{recording ? (
						<Waveform levels={voice.levels} />
					) : (
						<input
							ref={inputRef}
							data-testid="assistant-input"
							value={input}
							onChange={(event) => setInput(event.target.value)}
							placeholder={
								voice.state === "transcribing"
									? "Transcribing…"
									: "Ask, or tell me what to do"
							}
							aria-label="Message Autopilot"
							autoComplete="off"
							readOnly={voice.state === "transcribing"}
							maxLength={2000}
							className="h-11 min-w-0 flex-1 rounded-full bg-white/[0.07] px-4 text-[15px] text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
						/>
					)}
					<button
						type={stoppable ? "button" : "submit"}
						data-testid="assistant-send"
						onClick={stoppable ? halt : undefined}
						disabled={
							!stoppable &&
							(!input.trim() || voice.state !== "idle" || approvals.length > 0)
						}
						aria-label={stoppable ? "Stop" : "Send"}
						className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:bg-white/15 disabled:text-white/40"
					>
						{stoppable ? (
							<Square className="size-4 fill-current" aria-hidden />
						) : (
							<ArrowUp className="size-5" aria-hidden />
						)}
					</button>
				</form>
			</section>

			<AssistantApprovalDialog
				approval={approvals[0] ?? null}
				scope={`${organization.name} › ${project.name}`}
				onApprove={(approval) => resolveApproval(approval, true)}
				onDeny={(approval) => resolveApproval(approval, false)}
			/>
		</div>
	);
}

/**
 * Autopilot: a docked co-pilot that shows where things are and, with the
 * user's approval, does them through the page's WebMCP tools. Offered to
 * organizations with credits, which is what its model calls are billed to.
 */
export function AssistantDock() {
	const { projects } = useDashboardContext();
	const { organization, project: currentProject } = useDashboardTools();
	const pathname = usePathname();
	const [open, setOpen] = useState(false);

	// Organization pages carry no project in the URL, and the dashboard's
	// selected project can lag there. Stay on the last project the user was
	// actually in, so a conversation and its billing do not jump mid-task.
	const routeProjectId = extractOrgAndProjectFromPath(pathname).projectId;
	const [pinnedProjectId, setPinnedProjectId] = useState(routeProjectId);
	if (routeProjectId && routeProjectId !== pinnedProjectId) {
		setPinnedProjectId(routeProjectId);
	}
	const project =
		projects.find((candidate) => candidate.id === pinnedProjectId) ??
		currentProject ??
		projects[0] ??
		null;
	const hasCredits = new Decimal(organization?.credits ?? 0).greaterThan(0);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
				event.preventDefault();
				setOpen((value) => !value);
			}
			if (
				event.key === "Escape" &&
				event.target instanceof Element &&
				event.target.closest("[data-assistant-root]")
			) {
				setOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	if (!organization || !project || !hasCredits) {
		return null;
	}

	return (
		<>
			<AssistantSpotlight />
			<div
				data-assistant-root
				className={cn(
					"pointer-events-none fixed inset-x-0 z-[46] flex justify-center px-3",
					// Clear the support bubble where the open dock spans the screen.
					open ? "bottom-20 md:bottom-4" : "bottom-4",
				)}
			>
				<div
					className={cn(
						"pointer-events-auto",
						open ? "w-full max-w-[620px]" : "w-auto",
					)}
				>
					{/* Kept mounted while collapsed so the conversation survives. */}
					<div className={open ? undefined : "hidden"}>
						{/* Keyed by organization: only that starts a new conversation. */}
						<AssistantPanel
							key={organization.id}
							organization={organization}
							project={project}
							active={open}
							onClose={() => setOpen(false)}
						/>
					</div>
					{!open && (
						<button
							type="button"
							data-testid="assistant-launcher"
							onClick={() => setOpen(true)}
							aria-label="Open Autopilot assistant"
							aria-keyshortcuts="Meta+J Control+J"
							className="assistant-dock assistant-panel group flex h-12 items-center gap-2.5 rounded-full pr-2 pl-4 text-white transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
						>
							<span className="assistant-orb size-3 rounded-full" aria-hidden />
							<span className="font-mono text-[11px] font-semibold tracking-[0.22em] uppercase">
								Autopilot
							</span>
							<span className="hidden text-sm text-white/55 sm:inline">
								Ask or say what to do
							</span>
							<kbd className="hidden rounded-full bg-white/10 px-2 py-1 font-mono text-[10px] text-white/70 sm:inline">
								⌘J
							</kbd>
						</button>
					)}
				</div>
			</div>
		</>
	);
}
