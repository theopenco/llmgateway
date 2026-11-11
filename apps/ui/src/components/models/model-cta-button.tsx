"use client";

import { ArrowRight, BookOpen, Play } from "lucide-react";

import { useSessionStatus, useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";
import { getLoungeStudioPath } from "@/lib/model-utils";
import { usePostHog } from "@/lib/posthog";

// Endpoint-only models have no Lounge studio, so logged-in users get their docs.
const ENDPOINT_DOCS_PATHS: Record<string, string> = {
	embedding: "/features/embeddings",
	rerank: "/features/rerank",
	decision: "/features/system-one",
	search: "/features/search",
};

function useIsLoggedIn() {
	const { isAuthenticated } = useSessionStatus();
	const { user, isLoading } = useUser({ enabled: isAuthenticated });
	return !!user && !isLoading;
}

/**
 * A second way in for a signed-out visitor: the model open in Lounge chat,
 * before any API setup. Once logged in, the main button does this instead.
 * Render it only for models that pass `isLoungeChatModel`.
 */
export function TryInLoungeLink({
	modelId,
	location,
	className,
}: {
	modelId: string;
	location: string;
	className?: string;
}) {
	const config = useAppConfig();
	const posthog = usePostHog();
	const isLoggedIn = useIsLoggedIn();

	if (isLoggedIn) {
		return null;
	}

	return (
		<a
			href={`${config.playgroundUrl}?model=${encodeURIComponent(modelId)}`}
			target="_blank"
			rel="noopener noreferrer"
			data-testid="try-in-lounge"
			className={className}
			onClick={() =>
				posthog.capture("cta_clicked", { location, cta: "try_in_lounge" })
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
	location,
	onClick,
}: {
	modelId: string;
	output?: readonly string[] | null;
	size?: "default" | "sm";
	className?: string;
	iconClassName?: string;
	/** Where the button sits; clicks are tracked when set. */
	location?: string;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const config = useAppConfig();
	const posthog = usePostHog();
	const isLoggedIn = useIsLoggedIn();
	const track = (cta: string) => (event: React.MouseEvent) => {
		if (location) {
			posthog.capture("cta_clicked", { location, cta });
		}
		onClick?.(event);
	};

	const docsPath = output
		?.map((kind) => ENDPOINT_DOCS_PATHS[kind])
		.find((path) => path !== undefined);

	if (isLoggedIn && docsPath) {
		return (
			<Button
				variant="default"
				size={size}
				className={className}
				onClick={track("read_docs")}
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
				onClick={track("try_in_lounge")}
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
			onClick={track("get_started")}
			asChild
		>
			<a href={`${config.appUrl}/signup`}>
				Get Started
				<ArrowRight className={iconClassName} />
			</a>
		</Button>
	);
}
