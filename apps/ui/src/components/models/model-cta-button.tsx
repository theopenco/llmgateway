"use client";

import { ArrowRight, BookOpen, Play } from "lucide-react";

import { useSessionStatus, useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";
import { getLoungeStudioPath } from "@/lib/model-utils";
import { usePostHog } from "@/lib/posthog";

// Endpoint-only models have no Lounge studio, so logged-in users get their docs.
const ENDPOINT_DOCS_PATHS: Record<string, string> = {
	rerank: "/features/rerank",
	decision: "/features/system-one",
	search: "/features/search",
};

// Lounge has no studio for these; its model picker leaves them out.
const NO_LOUNGE_OUTPUTS = ["embedding", "rerank", "decision", "search"];

/**
 * A second way in for a signed-out visitor: the model open in Lounge, before
 * any API setup. Signed-in users already get that as the main button.
 */
export function TryInLoungeLink({
	modelId,
	output,
	className,
}: {
	modelId: string;
	output?: readonly string[] | null;
	className?: string;
}) {
	const config = useAppConfig();
	const posthog = usePostHog();
	const { isAuthenticated } = useSessionStatus();

	if (
		isAuthenticated ||
		output?.some((kind) => NO_LOUNGE_OUTPUTS.includes(kind))
	) {
		return null;
	}

	return (
		<a
			href={`${config.playgroundUrl}${getLoungeStudioPath(output)}?model=${encodeURIComponent(modelId)}`}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="try-in-lounge"
			className={className}
			onClick={() =>
				posthog.capture("cta_clicked", {
					location: "model_page_try_lounge",
					cta: "try_in_lounge",
				})
			}
		>
			<Play className="h-3.5 w-3.5" />
			Try in Lounge
		</a>
	);
}

export function ModelCtaButton({
	modelId,
	output,
	size = "default",
	className = "w-full gap-2 font-semibold group/cta",
	iconClassName = "h-4 w-4 transition-transform group-hover/cta:translate-x-0.5",
	onClick,
}: {
	modelId: string;
	output?: readonly string[] | null;
	size?: "default" | "sm";
	className?: string;
	iconClassName?: string;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const config = useAppConfig();
	const { isAuthenticated } = useSessionStatus();
	const { user, isLoading } = useUser({ enabled: isAuthenticated });
	const isLoggedIn = !!user && !isLoading;

	const docsPath = output
		?.map((kind) => ENDPOINT_DOCS_PATHS[kind])
		.find((path) => path !== undefined);

	if (isLoggedIn && docsPath) {
		return (
			<Button
				variant="default"
				size={size}
				className={className}
				onClick={onClick}
				asChild
			>
				<a href={`${config.docsUrl}${docsPath}`}>
					<BookOpen className={iconClassName} />
					View API docs
				</a>
			</Button>
		);
	}

	if (isLoggedIn) {
		const studioPath = getLoungeStudioPath(output);
		return (
			<Button
				variant="default"
				size={size}
				className={className}
				onClick={onClick}
				asChild
			>
				<a
					href={`${config.playgroundUrl}${studioPath}?model=${encodeURIComponent(modelId)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Play className={iconClassName} />
					Try in Lounge
				</a>
			</Button>
		);
	}

	return (
		<Button
			variant="default"
			size={size}
			className={className}
			onClick={onClick}
			asChild
		>
			<a href={`${config.appUrl}/signup`}>
				Get Started
				<ArrowRight className={iconClassName} />
			</a>
		</Button>
	);
}
