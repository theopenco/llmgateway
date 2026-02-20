"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	Copy,
	Check,
	Loader2,
	ArrowRight,
	ExternalLink,
	LayoutDashboard,
	FlaskConical,
	BookOpen,
	Send,
	KeyRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";

import { QuickStartSection } from "@/components/shared/quick-start-snippet";
import { useDefaultProject } from "@/hooks/useDefaultProject";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Textarea } from "@/lib/components/textarea";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

const DEFAULT_PROMPT = "Explain what an LLM gateway is in 2 sentences.";

export function OnboardingWizard() {
	const router = useRouter();
	const posthog = usePostHog();
	const queryClient = useQueryClient();
	const api = useApi();
	const config = useAppConfig();
	const { data: project } = useDefaultProject();

	const [apiKey, setApiKey] = useState<string | null>(null);
	const [apiKeyLoading, setApiKeyLoading] = useState(true);
	const [copied, setCopied] = useState(false);
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [tryLoading, setTryLoading] = useState(false);
	const [tryResponse, setTryResponse] = useState<string | null>(null);
	const [tryError, setTryError] = useState<string | null>(null);
	const [triedApi, setTriedApi] = useState(false);
	const [isCompleting, setIsCompleting] = useState(false);
	const hasTrackedView = useRef(false);

	const completeOnboarding = api.useMutation(
		"post",
		"/user/me/complete-onboarding",
	);

	// Track view on mount
	useEffect(() => {
		if (!hasTrackedView.current) {
			posthog.capture("onboarding_viewed");
			hasTrackedView.current = true;
		}
	}, [posthog]);

	// Fetch API key
	useEffect(() => {
		if (!project?.id) {
			return;
		}

		const fetchKey = async () => {
			try {
				const res = await fetch(`${config.apiUrl}/playground/ensure-key`, {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId: project.id }),
				});
				if (res.ok) {
					const data = (await res.json()) as { ok: boolean; token: string };
					if (data.token) {
						setApiKey(data.token);
					}
				}
			} catch {
				// Key fetch failed silently
			} finally {
				setApiKeyLoading(false);
			}
		};

		void fetchKey();
	}, [project?.id, config.apiUrl]);

	const handleCopyKey = () => {
		if (!apiKey) {
			return;
		}
		navigator.clipboard.writeText(apiKey);
		setCopied(true);
		posthog.capture("onboarding_api_key_copied");
		setTimeout(() => setCopied(false), 2000);
	};

	const handleTryIt = async () => {
		if (!prompt.trim() || !apiKey) {
			return;
		}
		posthog.capture("onboarding_try_clicked", { prompt });
		setTryLoading(true);
		setTryResponse(null);
		setTryError(null);
		const startTime = Date.now();

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30_000);

		try {
			const res = await fetch(`${config.gatewayUrl}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: "auto",
					messages: [{ role: "user", content: prompt.trim() }],
					max_tokens: 200,
					free_models_only: true,
					onboarding: true,
				}),
				signal: controller.signal,
			});

			const data = await res.json();

			if (!res.ok) {
				const errorMsg = data.error?.message || "Request failed";
				setTryError(errorMsg);
				posthog.capture("onboarding_try_error", { error: errorMsg });
				return;
			}

			const content =
				data.choices?.[0]?.message?.content || "No response received";
			setTryResponse(content);
			setTriedApi(true);
			posthog.capture("onboarding_try_success", {
				model: data.model || "auto",
				responseTimeMs: Date.now() - startTime,
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				setTryError("Request timed out. Please try again.");
				posthog.capture("onboarding_try_error", { error: "timeout" });
			} else {
				setTryError("Network error. Please try again.");
				posthog.capture("onboarding_try_error", { error: "network_error" });
			}
		} finally {
			clearTimeout(timeout);
			setTryLoading(false);
		}
	};

	const handleGoToDashboard = async () => {
		setIsCompleting(true);
		posthog.capture("onboarding_completed", { triedApi });
		try {
			await completeOnboarding.mutateAsync({});
			const queryKey = api.queryOptions("get", "/user/me").queryKey;
			await queryClient.invalidateQueries({ queryKey });
			router.push("/dashboard");
		} catch {
			setIsCompleting(false);
		}
	};

	return (
		<div className="container mx-auto max-w-3xl py-10">
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">Make your first API call</h1>
					<p className="text-muted-foreground">
						Your account is ready. Grab your API key and try it out.
					</p>
				</div>

				{/* API Key Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							Your API Key
						</CardTitle>
						<CardDescription>
							Use this key to authenticate requests to LLM Gateway
						</CardDescription>
					</CardHeader>
					<CardContent>
						{apiKeyLoading ? (
							<div className="h-10 w-full animate-pulse rounded-md bg-muted" />
						) : apiKey ? (
							<div className="flex items-center gap-2">
								<code className="flex-1 rounded-md border bg-muted/50 p-3 text-sm font-mono break-all">
									{apiKey}
								</code>
								<Button
									variant="outline"
									size="sm"
									onClick={handleCopyKey}
									className="shrink-0"
								>
									{copied ? (
										<Check className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</Button>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								Could not load API key. You can create one from the dashboard.
							</p>
						)}
					</CardContent>
				</Card>

				{/* Try It Now Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<FlaskConical className="h-5 w-5" />
							Try it now
						</CardTitle>
						<CardDescription>
							Send a real request using a free model — no credits needed
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<Textarea
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder="Enter a prompt..."
							rows={2}
							className="resize-none"
						/>

						<Button
							onClick={handleTryIt}
							disabled={tryLoading || !prompt.trim() || !apiKey}
							className="w-full"
						>
							{tryLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Sending...
								</>
							) : (
								<>
									<Send className="mr-2 h-4 w-4" />
									Send request
								</>
							)}
						</Button>

						{tryError && (
							<div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
								<p className="text-sm text-red-800 dark:text-red-200">
									{tryError}
								</p>
							</div>
						)}

						{tryResponse && (
							<div className="rounded-md border bg-muted/50 p-4">
								<p className="text-xs font-medium text-muted-foreground mb-2">
									Response
								</p>
								<p className="text-sm whitespace-pre-wrap">{tryResponse}</p>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Quick Start Snippets */}
				<QuickStartSection apiKey={apiKey ?? undefined} />

				{/* What's Next Card */}
				<Card>
					<CardHeader>
						<CardTitle>What&apos;s next?</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						<Button asChild variant="outline" className="w-full justify-start">
							<Link href="/dashboard">
								<LayoutDashboard className="mr-2 h-4 w-4" />
								Dashboard
								<ArrowRight className="ml-auto h-4 w-4" />
							</Link>
						</Button>
						<Button asChild variant="outline" className="w-full justify-start">
							<a
								href={config.playgroundUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<FlaskConical className="mr-2 h-4 w-4" />
								Playground
								<ExternalLink className="ml-auto h-4 w-4" />
							</a>
						</Button>
						<Button asChild variant="outline" className="w-full justify-start">
							<a
								href={config.docsUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<BookOpen className="mr-2 h-4 w-4" />
								Documentation
								<ExternalLink className="ml-auto h-4 w-4" />
							</a>
						</Button>
					</CardContent>
				</Card>

				{/* Go to Dashboard */}
				<Button
					size="lg"
					onClick={handleGoToDashboard}
					disabled={isCompleting}
					className="w-full"
				>
					{isCompleting ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Setting up...
						</>
					) : (
						<>
							Go to Dashboard
							<ArrowRight className="ml-2 h-4 w-4" />
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
