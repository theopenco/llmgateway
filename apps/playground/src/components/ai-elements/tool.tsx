"use client";

import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	WrenchIcon,
	XCircleIcon,
} from "lucide-react";
import { isValidElement } from "react";

import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ImageZoom } from "@/components/ui/image-zoom";
import { cn } from "@/lib/utils";

import { CodeBlock } from "./code-block";
import { Image } from "./image";

import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible
		className={cn("not-prose mb-4 w-full rounded-md border", className)}
		{...props}
	/>
);

export interface ToolHeaderProps {
	title?: string;
	type: ToolUIPart["type"];
	state: ToolUIPart["state"];
	className?: string;
}

const getStatusBadge = (status: ToolUIPart["state"]) => {
	const labels: Record<ToolUIPart["state"], string> = {
		"input-streaming": "Pending",
		"input-available": "Running",
		"approval-requested": "Approval Requested",
		"approval-responded": "Approval Responded",
		"output-available": "Completed",
		"output-error": "Error",
		"output-denied": "Denied",
	};

	const icons: Record<ToolUIPart["state"], ReactNode> = {
		"input-streaming": <CircleIcon className="size-4" />,
		"input-available": <ClockIcon className="size-4 animate-pulse" />,
		"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
		"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
		"output-available": <CheckCircleIcon className="size-4 text-green-600" />,
		"output-error": <XCircleIcon className="size-4 text-red-600" />,
		"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	};

	return (
		<Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
			{icons[status]}
			{labels[status]}
		</Badge>
	);
};

export const ToolHeader = ({
	className,
	title,
	type,
	state,
	...props
}: ToolHeaderProps) => (
	<CollapsibleTrigger
		className={cn(
			"flex w-full items-center justify-between gap-4 p-3",
			className,
		)}
		{...props}
	>
		<div className="flex items-center gap-2">
			<WrenchIcon className="size-4 text-muted-foreground" />
			<span className="font-medium text-sm">
				{title ?? type.split("-").slice(1).join("-")}
			</span>
			{getStatusBadge(state)}
		</div>
		<ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
	</CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
);

export type ToolInputProps = ComponentProps<"div"> & {
	input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
		<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
			Parameters
		</h4>
		<div className="rounded-md bg-muted/50">
			<CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
		</div>
	</div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
	output: ToolUIPart["output"];
	errorText: ToolUIPart["errorText"];
};

/**
 * Check if output contains image data from generate-image tool
 * Images are returned as { base64: string, mediaType: string } objects
 */
function hasImageOutput(output: unknown): output is {
	images: { base64: string; mediaType: string }[];
	text?: string;
} {
	if (
		typeof output !== "object" ||
		output === null ||
		!("images" in output) ||
		!Array.isArray((output as { images: unknown }).images)
	) {
		return false;
	}
	const images = (output as { images: unknown[] }).images;
	if (images.length === 0) {
		return false;
	}
	const first = images[0];
	return (
		typeof first === "object" &&
		first !== null &&
		"base64" in first &&
		"mediaType" in first &&
		typeof (first as { base64: unknown }).base64 === "string" &&
		typeof (first as { mediaType: unknown }).mediaType === "string"
	);
}

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null;
	}

	let Output = <div>{output as ReactNode}</div>;

	// Check for image output from generate-image tool
	if (hasImageOutput(output)) {
		Output = (
			<div className="space-y-4 p-2">
				{output.text && (
					<p className="text-sm text-muted-foreground">{output.text}</p>
				)}
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{output.images.map((img, index) => (
						<ImageZoom key={index}>
							<Image
								base64={img.base64}
								mediaType={img.mediaType}
								alt={`Generated image ${index + 1}`}
								className="h-[400px] aspect-auto border rounded-lg object-cover"
							/>
						</ImageZoom>
					))}
				</div>
			</div>
		);
	} else if (typeof output === "object" && !isValidElement(output)) {
		Output = (
			<CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
		);
	} else if (typeof output === "string") {
		Output = <CodeBlock code={output} language="json" />;
	}

	return (
		<div className={cn("space-y-2 p-4", className)} {...props}>
			<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{errorText ? "Error" : "Result"}
			</h4>
			<div
				className={cn(
					"overflow-x-auto rounded-md text-xs [&_table]:w-full",
					errorText
						? "bg-destructive/10 text-destructive"
						: "bg-muted/50 text-foreground",
				)}
			>
				{errorText && <div>{errorText}</div>}
				{Output}
			</div>
		</div>
	);
};
