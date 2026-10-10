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

import {
	cancellationCommentsRequired,
	DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH,
	DEV_PLAN_CANCELLATION_REASON_OPTIONS,
	DEV_PLAN_CANCELLATION_REASONS,
	type DevPlanCancellationReason,
} from "@llmgateway/shared";

export type PreviousDevPlan = "lite" | "pro" | "max" | null;

export interface ExistingFeedback {
	reason: DevPlanCancellationReason;
	comments: string | null;
	submittedAt: string;
}

const formSchema = z
	.object({
		reason: z.enum(DEV_PLAN_CANCELLATION_REASONS, {
			errorMap: () => ({ message: "Please pick a reason." }),
		}),
		comments: z
			.string()
			.max(
				DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH,
				`Keep it under ${DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH} characters.`,
			),
	})
	.refine(
		(values) =>
			!cancellationCommentsRequired(values.reason) ||
			values.comments.trim().length > 0,
		{ message: "Tell us a little more.", path: ["comments"] },
	);

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
	const reason = form.watch("reason");
	const selectedOption = DEV_PLAN_CANCELLATION_REASON_OPTIONS.find(
		(option) => option.value === reason,
	);
	const commentsRequired = reason
		? cancellationCommentsRequired(reason)
		: false;

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
									{DEV_PLAN_CANCELLATION_REASON_OPTIONS.map((option) => {
										const selected = field.value === option.value;
										const inputId = `reason-${option.value}`;
										return (
											<FormLabel
												key={option.value}
												htmlFor={inputId}
												className={cn(
													"flex cursor-pointer items-center gap-3 rounded-xl border p-4 font-normal transition-colors",
													selected
														? "border-primary bg-primary/5"
														: "hover:bg-muted/50",
												)}
											>
												<RadioGroupItem id={inputId} value={option.value} />
												<span className="text-sm font-medium">
													{option.label}
												</span>
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
								{selectedOption?.prompt ?? "Anything else?"}
								{!commentsRequired && (
									<span className="font-normal text-muted-foreground">
										{" "}
										(optional)
									</span>
								)}
							</FormLabel>
							<FormControl>
								<Textarea
									rows={5}
									maxLength={DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH}
									placeholder={
										selectedOption?.placeholder ??
										"What got in the way, what was missing, or what would bring you back?"
									}
									{...field}
								/>
							</FormControl>
							<div className="flex items-center justify-between">
								<FormMessage />
								<p className="text-xs text-muted-foreground ml-auto">
									{comments.length}/{DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH}
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
