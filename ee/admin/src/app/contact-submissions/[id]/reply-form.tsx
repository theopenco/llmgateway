"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFetchClient } from "@/lib/fetch-client";

interface ReplyFormProps {
	submissionId: string;
	name: string;
	email: string;
	country: string;
	size: string;
	message: string;
}

export function ReplyForm({
	submissionId,
	name,
	email,
	country,
	size,
	message,
}: ReplyFormProps) {
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [context, setContext] = useState("");
	const [sending, setSending] = useState(false);
	const [generating, setGenerating] = useState(false);
	const fetchClient = useFetchClient();

	const handleGenerate = async () => {
		setGenerating(true);
		try {
			const res = await fetch("/api/generate-reply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					email,
					country,
					size,
					message,
					type: "enterprise",
					context: context || undefined,
				}),
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error ?? "Failed to generate reply");
			}

			const data: { subject: string; body: string } = await res.json();
			setSubject(data.subject);
			setBody(data.body);
			toast.success("Draft generated");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to generate reply",
			);
		} finally {
			setGenerating(false);
		}
	};

	const handleSend = async () => {
		if (!subject.trim() || !body.trim()) {
			toast.error("Subject and body are required");
			return;
		}

		setSending(true);
		try {
			const { data, error } = await fetchClient.POST(
				"/admin/contact-submissions/{id}/reply",
				{
					params: { path: { id: submissionId } },
					body: { subject, body },
				},
			);

			if (error) {
				const msg =
					typeof error === "object" && "message" in error
						? (error as { message: string }).message
						: "Failed to send reply";
				toast.error(msg);
				return;
			}

			if (data?.success) {
				toast.success("Reply sent successfully");
				setSubject("");
				setBody("");
			} else {
				toast.error(data?.message ?? "Failed to send reply");
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to send reply");
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="rounded-lg border border-border/60 bg-card p-6">
			<h2 className="mb-4 text-lg font-medium">Reply to {name}</h2>
			<p className="mb-4 text-sm text-muted-foreground">
				Send a reply to {email} from contact@llmgateway.io
			</p>

			<div className="flex flex-col gap-4">
				<div>
					<Label htmlFor="context">Additional Context (optional)</Label>
					<Input
						id="context"
						placeholder="e.g. They already use OpenAI directly..."
						value={context}
						onChange={(e) => setContext(e.target.value)}
						className="mt-1"
					/>
				</div>

				<Button
					variant="outline"
					onClick={handleGenerate}
					disabled={generating}
					className="w-full"
				>
					{generating ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<Sparkles className="mr-2 h-4 w-4" />
					)}
					{generating ? "Generating draft..." : "Generate reply with AI"}
				</Button>

				<div>
					<Label htmlFor="subject">Subject</Label>
					<Input
						id="subject"
						placeholder="Re: Enterprise inquiry"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						className="mt-1"
					/>
				</div>

				<div>
					<Label htmlFor="body">Body</Label>
					<Textarea
						id="body"
						placeholder="Write your reply..."
						value={body}
						onChange={(e) => setBody(e.target.value)}
						rows={12}
						className="mt-1"
					/>
				</div>

				<Button
					onClick={handleSend}
					disabled={sending || !subject.trim() || !body.trim()}
				>
					{sending ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<Send className="mr-2 h-4 w-4" />
					)}
					{sending ? "Sending..." : "Send Reply"}
				</Button>
			</div>
		</div>
	);
}
