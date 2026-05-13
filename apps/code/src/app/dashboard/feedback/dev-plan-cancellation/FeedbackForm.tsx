"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v3";

import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const REASON_VALUES = [
	"too_expensive",
	"missing_features",
	"not_using_enough",
	"switched_alternative",
	"other",
] as const;

type Reason = (typeof REASON_VALUES)[number];

export type PreviousDevPlan = "lite" | "pro" | "max" | null;

export interface ExistingFeedback {
	reason: Reason;
	comments: string | null;
	submittedAt: string;
}

const REASONS: { value: Reason; label: string; description: string }[] = [
	{
		value: "too_expensive",
		label: "Too expensive",
		description: "The price didn't fit my budget.",
	},
	{
		value: "missing_features",
		label: "Missing features",
		description: "Something I needed wasn't available.",
	},
	{
		value: "not_using_enough",
		label: "Not using it enough",
		description: "I didn't get enough value out of it.",
	},
	{
		value: "switched_alternative",
		label: "Switched to an alternative",
		description: "I'm using something else now.",
	},
	{
		value: "other",
		label: "Something else",
		description: "I'll explain in the comments.",
	},
];

const formSchema = z.object({
	reason: z.enum(REASON_VALUES, {
		errorMap: () => ({ message: "Please pick a reason." }),
	}),
	comments: z.string().max(2000, "Keep it under 2000 characters."),
});

type FormValues = z.infer<typeof formSchema>;

export default function FeedbackForm({
	existingFeedback,
	previousDevPlan,
}: {
	existingFeedback: ExistingFeedback | null;
	previousDevPlan: PreviousDevPlan;
}) {
	const api = useApi();
	const router = useRouter();
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();

	const submitMutation = api.useMutation(
		"post",
		"/dev-plan-cancellation-feedback/submit",
	);

	const form = useForm<FormValues>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			reason: existingFeedback?.reason,
			comments: existingFeedback?.comments ?? "",
		},
	});

	const isUpdating = existingFeedback !== null;
	const comments = form.watch("comments");

	async function onSubmit(values: FormValues) {
		const trimmedComments = values.comments.trim();
		try {
			await submitMutation.mutateAsync({
				body: {
					reason: values.reason,
					comments: trimmedComments || undefined,
				},
			});
			if (posthogKey) {
				posthog.capture("dev_plan_cancellation_feedback_submitted", {
					reason: values.reason,
					previous_dev_plan: previousDevPlan,
					has_comments: trimmedComments.length > 0,
					is_update: isUpdating,
				});
			}
			toast.success("Thanks for the feedback!");
			router.push("/dashboard");
		} catch {
			toast.error("Couldn't save your feedback. Please try again.");
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
				<div className="space-y-2">
					<h1 className="text-2xl font-semibold">
						{isUpdating
							? "Update your feedback"
							: "Sorry to see you go — what happened?"}
					</h1>
					<p className="text-sm text-muted-foreground">
						Your Dev Plan was cancelled
						{previousDevPlan ? ` (${previousDevPlan.toUpperCase()})` : ""}. A
						few seconds of feedback will directly shape what we build next.
					</p>
				</div>

				<FormField
					control={form.control}
					name="reason"
					render={({ field }) => (
						<FormItem className="space-y-3">
							<FormLabel className="text-sm font-medium">
								Primary reason
							</FormLabel>
							<FormControl>
								<RadioGroup
									value={field.value}
									onValueChange={field.onChange}
									className="gap-2"
								>
									{REASONS.map((option) => {
										const selected = field.value === option.value;
										const inputId = `reason-${option.value}`;
										return (
											<FormLabel
												key={option.value}
												htmlFor={inputId}
												className={cn(
													"flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal transition-colors",
													selected
														? "border-primary bg-primary/5"
														: "hover:bg-muted/50",
												)}
											>
												<RadioGroupItem
													id={inputId}
													value={option.value}
													className="mt-0.5"
												/>
												<div className="space-y-0.5">
													<div className="text-sm font-medium">
														{option.label}
													</div>
													<div className="text-xs text-muted-foreground">
														{option.description}
													</div>
												</div>
											</FormLabel>
										);
									})}
								</RadioGroup>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="comments"
					render={({ field }) => (
						<FormItem>
							<FormLabel className="text-sm font-medium">
								Anything else? (optional)
							</FormLabel>
							<FormControl>
								<Textarea
									rows={5}
									maxLength={2000}
									placeholder="What got in the way, what was missing, or what would bring you back?"
									{...field}
								/>
							</FormControl>
							<div className="flex items-center justify-between">
								<FormMessage />
								<p className="text-xs text-muted-foreground ml-auto">
									{comments.length}/2000
								</p>
							</div>
						</FormItem>
					)}
				/>

				<div className="flex items-center justify-between gap-3">
					<Button asChild variant="ghost">
						<Link href="/dashboard">Skip</Link>
					</Button>
					<Button type="submit" disabled={submitMutation.isPending}>
						{submitMutation.isPending
							? "Saving…"
							: isUpdating
								? "Update feedback"
								: "Send feedback"}
					</Button>
				</div>
			</form>
		</Form>
	);
}
