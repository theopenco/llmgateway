"use client";

import { ArrowRight, Play } from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import { useAppConfig } from "@/lib/config";

export function ModelCtaButton({
	modelId,
	size = "default",
	className = "w-full gap-2 font-semibold group/cta",
	iconClassName = "h-4 w-4 transition-transform group-hover/cta:translate-x-0.5",
	onClick,
}: {
	modelId: string;
	size?: "default" | "sm";
	className?: string;
	iconClassName?: string;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const config = useAppConfig();
	const { user, isLoading } = useUser();
	const isLoggedIn = !!user && !isLoading;

	if (isLoggedIn) {
		return (
			<Button
				variant="default"
				size={size}
				className={className}
				onClick={onClick}
				asChild
			>
				<a
					href={`${config.playgroundUrl}?model=${encodeURIComponent(modelId)}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					<Play className={iconClassName} />
					Try in Playground
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
