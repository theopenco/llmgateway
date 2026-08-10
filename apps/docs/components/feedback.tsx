"use client";
import { cva } from "class-variance-authority";
import {
	Collapsible,
	CollapsibleContent,
} from "fumadocs-ui/components/ui/collapsible";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
	type SyntheticEvent,
	useEffect,
	useReducer,
	useState,
	useTransition,
} from "react";

import { cn } from "../lib/cn";
import { buttonVariants } from "./ui/button";

const rateButtonVariants = cva(
	"inline-flex items-center gap-2 px-3 py-2 rounded-full font-medium border text-sm [&_svg]:size-4 disabled:cursor-not-allowed",
	{
		variants: {
			active: {
				true: "bg-fd-accent text-fd-accent-foreground [&_svg]:fill-current",
				false: "text-fd-muted-foreground",
			},
		},
	},
);

export interface Feedback {
	opinion: "good" | "bad";
	url?: string;
	message: string;
}

export interface ActionResponse {
	githubUrl: string;
}

interface Result extends Feedback {
	response?: ActionResponse;
}

// localStorage throws outright in Safari Private Browsing and when site data is
// blocked, so persistence is best-effort: it must never take the widget down or
// block the confirmation UI.
function readStoredFeedback(url: string): Result | null {
	try {
		const item = localStorage.getItem(`docs-feedback-${url}`);
		return item === null ? null : (JSON.parse(item) as Result);
	} catch {
		return null;
	}
}

function writeStoredFeedback(url: string, result: Result | null) {
	try {
		if (result) {
			localStorage.setItem(`docs-feedback-${url}`, JSON.stringify(result));
		} else {
			localStorage.removeItem(`docs-feedback-${url}`);
		}
	} catch {
		// Ignore: the rating is already recorded server-side and in PostHog.
	}
}

export function Feedback({
	onRateAction,
}: {
	onRateAction: (url: string) => Promise<ActionResponse>;
}) {
	const url = usePathname();
	const posthog = usePostHog();
	const [previous, replacePrevious] = useReducer(
		(_previous: Result | null, nextPrevious: Result | null) => nextPrevious,
		null,
	);
	const [opinion, setOpinion] = useState<"good" | "bad" | null>(null);
	const [message, setMessage] = useState("");
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		replacePrevious(readStoredFeedback(url));
	}, [url]);

	function submit(e?: SyntheticEvent) {
		if (opinion === null) {
			return;
		}

		startTransition(() => {
			const feedback: Feedback = {
				opinion,
				message,
			};

			posthog.capture("on_rate_docs", { ...feedback, url });
			void onRateAction(url).then((response) => {
				const result: Result = {
					response,
					...feedback,
				};
				// Commit the UI first: a storage failure must not swallow the
				// confirmation panel and leave Submit looking unresponsive.
				replacePrevious(result);
				setMessage("");
				setOpinion(null);
				writeStoredFeedback(url, result);
			});
		});

		e?.preventDefault();
	}

	const activeOpinion = previous?.opinion ?? opinion;

	return (
		<Collapsible
			open={opinion !== null || previous !== null}
			onOpenChange={(v: boolean) => {
				if (!v) {
					setOpinion(null);
				}
			}}
			className="border-y py-3"
		>
			<div className="flex flex-row items-center gap-2">
				<p className="text-sm font-medium pe-2">How is this guide?</p>
				<button
					disabled={previous !== null}
					className={cn(
						rateButtonVariants({
							active: activeOpinion === "good",
						}),
					)}
					onClick={() => {
						setOpinion("good");
					}}
				>
					<ThumbsUp />
					Good
				</button>
				<button
					disabled={previous !== null}
					className={cn(
						rateButtonVariants({
							active: activeOpinion === "bad",
						}),
					)}
					onClick={() => {
						setOpinion("bad");
					}}
				>
					<ThumbsDown />
					Bad
				</button>
			</div>
			<CollapsibleContent className="mt-3">
				{previous ? (
					<div className="px-3 py-6 flex flex-col items-center gap-3 bg-fd-card text-fd-muted-foreground text-sm text-center rounded-xl">
						<p>Thank you for your feedback!</p>
						<div className="flex flex-row items-center gap-2">
							<a
								href={previous.response?.githubUrl}
								rel="noreferrer noopener"
								target="_blank"
								className={cn(
									buttonVariants({
										color: "primary",
									}),
									"text-xs",
								)}
							>
								View on GitHub
							</a>

							<button
								className={cn(
									buttonVariants({
										color: "secondary",
									}),
									"text-xs",
								)}
								onClick={() => {
									setOpinion(previous.opinion);
									replacePrevious(null);
									writeStoredFeedback(url, null);
								}}
							>
								Submit Again
							</button>
						</div>
					</div>
				) : (
					<form className="flex flex-col gap-3" onSubmit={submit}>
						<textarea
							autoFocus
							required
							value={message}
							onChange={(e) => {
								setMessage(e.target.value);
							}}
							className="border rounded-lg bg-fd-secondary text-fd-secondary-foreground p-3 resize-none focus-visible:outline-none placeholder:text-fd-muted-foreground"
							placeholder="Leave your feedback..."
							onKeyDown={(e) => {
								if (!e.shiftKey && e.key === "Enter") {
									submit(e);
								}
							}}
						/>
						<button
							type="submit"
							className={cn(buttonVariants({ color: "outline" }), "w-fit px-3")}
							disabled={isPending}
						>
							Submit
						</button>
					</form>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
