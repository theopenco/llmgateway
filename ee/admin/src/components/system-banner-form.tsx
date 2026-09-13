"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
	SYSTEM_BANNER_DEFAULT_LINK_LABEL,
	SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH,
	SYSTEM_BANNER_MESSAGE_MAX_LENGTH,
} from "@llmgateway/shared";
import { SystemBannerBar } from "@llmgateway/shared/system-banner";

import type { SystemBannerSettingInput } from "@/lib/admin-settings";
import type { SystemBannerSeverity } from "@llmgateway/shared";

const severityLabels: Record<SystemBannerSeverity, string> = {
	info: "Info — announcements and maintenance notices",
	warning: "Warning — degraded service",
	critical: "Critical — outage or data-affecting incident",
};

interface SystemBannerFormProps {
	banner: SystemBannerSettingInput;
	onSave: (
		input: SystemBannerSettingInput,
	) => Promise<{ ok: boolean; message: string | null }>;
}

export function SystemBannerForm({ banner, onSave }: SystemBannerFormProps) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [enabled, setEnabled] = useState(banner.enabled);
	const [message, setMessage] = useState(banner.message);
	const [severity, setSeverity] = useState<SystemBannerSeverity>(
		banner.severity,
	);
	const [linkUrl, setLinkUrl] = useState(banner.linkUrl ?? "");
	const [linkLabel, setLinkLabel] = useState(banner.linkLabel ?? "");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const trimmedMessage = message.trim();
	const trimmedLink = linkUrl.trim();

	const save = (nextEnabled: boolean) => {
		setError(null);
		setSaved(false);
		startTransition(async () => {
			const result = await onSave({
				enabled: nextEnabled,
				message,
				severity,
				linkUrl: trimmedLink || null,
				linkLabel: linkLabel.trim() || null,
			});
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setEnabled(nextEnabled);
			setSaved(true);
			router.refresh();
		});
	};

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				save(enabled);
			}}
		>
			<div className="flex items-center gap-3">
				<Switch
					id="system-banner-enabled"
					checked={enabled}
					disabled={pending || (!enabled && !trimmedMessage)}
					onCheckedChange={(checked) => {
						setEnabled(checked);
						save(checked);
					}}
				/>
				<Label htmlFor="system-banner-enabled">
					{enabled ? "Live on all sites" : "Hidden"}
				</Label>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="system-banner-message">Message</Label>
				<Textarea
					id="system-banner-message"
					rows={2}
					maxLength={SYSTEM_BANNER_MESSAGE_MAX_LENGTH}
					placeholder="e.g. Some providers are returning errors. We're on it."
					value={message}
					disabled={pending}
					onChange={(event) => {
						setMessage(event.target.value);
						setSaved(false);
					}}
				/>
				<p className="text-xs text-muted-foreground">
					{trimmedMessage.length}/{SYSTEM_BANNER_MESSAGE_MAX_LENGTH}
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="system-banner-severity">Severity</Label>
				<Select
					value={severity}
					disabled={pending}
					onValueChange={(value) => {
						setSeverity(value as SystemBannerSeverity);
						setSaved(false);
					}}
				>
					<SelectTrigger id="system-banner-severity" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{Object.entries(severityLabels).map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-2 sm:flex-row">
				<div className="flex flex-1 flex-col gap-2">
					<Label htmlFor="system-banner-link-url">Link (optional)</Label>
					<Input
						id="system-banner-link-url"
						type="url"
						inputMode="url"
						placeholder="https://status.llmgateway.io"
						value={linkUrl}
						disabled={pending}
						onChange={(event) => {
							setLinkUrl(event.target.value);
							setSaved(false);
						}}
					/>
				</div>
				<div className="flex flex-col gap-2 sm:w-56">
					<Label htmlFor="system-banner-link-label">Button label</Label>
					<Input
						id="system-banner-link-label"
						maxLength={SYSTEM_BANNER_LINK_LABEL_MAX_LENGTH}
						placeholder={SYSTEM_BANNER_DEFAULT_LINK_LABEL}
						value={linkLabel}
						disabled={pending || !trimmedLink}
						onChange={(event) => {
							setLinkLabel(event.target.value);
							setSaved(false);
						}}
					/>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<Label>Preview</Label>
				{trimmedMessage ? (
					<div className="overflow-hidden rounded-lg border">
						<SystemBannerBar
							banner={{
								message: trimmedMessage,
								severity,
								linkUrl: trimmedLink || null,
								linkLabel: (trimmedLink && linkLabel.trim()) || null,
							}}
							className="border-b-0"
						/>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Write a message to preview the banner.
					</p>
				)}
			</div>

			<div className="flex items-center gap-3">
				<Button type="submit" disabled={pending}>
					{pending ? "Saving…" : "Save"}
				</Button>
				{error && <p className="text-sm text-destructive">{error}</p>}
				{saved && !error && (
					<p className="text-sm text-muted-foreground">Saved.</p>
				)}
			</div>
		</form>
	);
}
