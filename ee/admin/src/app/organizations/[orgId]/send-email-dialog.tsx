"use client";

import { Loader2, Mail, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFetchClient } from "@/lib/fetch-client";

interface SendEmailDialogProps {
	userName: string;
	userEmail: string;
	orgName: string;
	plan: string;
}

export function SendEmailDialog({
	userName,
	userEmail,
	orgName,
	plan,
}: SendEmailDialogProps) {
	const [open, setOpen] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [context, setContext] = useState("");
	const [sending, setSending] = useState(false);
	const [generating, setGenerating] = useState(false);
	const fetchClient = useFetchClient();

	const handleGenerate = async () => {
		if (!apiKey.trim()) {
			toast.error("Please enter your LLM Gateway API key first");
			return;
		}

		setGenerating(true);
		try {
			const res = await fetch("/api/generate-reply", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					apiKey,
					name: userName,
					email: userEmail,
					orgName,
					plan,
					type: "signup",
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
			const { data } = await fetchClient.POST("/admin/send-email", {
				body: { to: userEmail, subject, body },
			});

			if (data?.success) {
				toast.success("Email sent successfully");
				setOpen(false);
				setSubject("");
				setBody("");
			} else {
				toast.error(data?.message ?? "Failed to send email");
			}
		} catch {
			toast.error("Failed to send email");
		} finally {
			setSending(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm" className="h-7 w-7 p-0">
					<Mail className="h-3.5 w-3.5" />
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Email {userName || userEmail}</DialogTitle>
					<DialogDescription>
						Send an email to {userEmail} from contact@llmgateway.io
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div>
						<Label htmlFor="apiKey">LLM Gateway API Key</Label>
						<Input
							id="apiKey"
							type="password"
							placeholder="sk-..."
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							className="mt-1"
						/>
					</div>

					<div>
						<Label htmlFor="context">Additional Context (optional)</Label>
						<Input
							id="context"
							placeholder="e.g. They're interested in image generation..."
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
						{generating ? "Generating draft..." : "Generate with AI"}
					</Button>

					<div>
						<Label htmlFor="subject">Subject</Label>
						<Input
							id="subject"
							placeholder="Welcome to LLM Gateway"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							className="mt-1"
						/>
					</div>

					<div>
						<Label htmlFor="body">Body</Label>
						<Textarea
							id="body"
							placeholder="Write your email..."
							value={body}
							onChange={(e) => setBody(e.target.value)}
							rows={10}
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
						{sending ? "Sending..." : "Send Email"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
