"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { CarrierMark } from "@llmgateway/shared/carrier-mark";

const LOGO_MAX_BYTES = 200 * 1024;
const ICON_MAX_BYTES = 64 * 1024;

function readSvgAsDataUrl(file: File, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		if (file.type !== "image/svg+xml") {
			reject(new Error("Use an SVG image."));
			return;
		}
		if (file.size > maxBytes) {
			reject(
				new Error(
					`Image must be smaller than ${Math.round(maxBytes / 1024)}KB.`,
				),
			);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Failed to read the image."));
		reader.readAsDataURL(file);
	});
}

function ThemePreview({
	src,
	providerName,
	theme,
	type,
}: {
	src: string;
	providerName: string;
	theme: "light" | "dark";
	type: "logo" | "icon";
}) {
	const isDark = theme === "dark";
	const themeClasses = isDark
		? "border-slate-800 bg-slate-950 text-slate-50"
		: "border-slate-200 bg-white text-slate-950";
	const mutedClasses = isDark ? "text-slate-400" : "text-slate-500";

	return (
		<div className={`min-w-0 border p-3 ${themeClasses}`}>
			<p className={`mb-3 text-[10px] font-semibold uppercase ${mutedClasses}`}>
				{isDark ? "Dark" : "Light"}
			</p>
			{type === "logo" ? (
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden">
						<CarrierMark
							src={src}
							alt={`${providerName} logo on ${theme} background`}
							className="size-12 object-contain"
						/>
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">{providerName}</p>
						<p className={`text-xs ${mutedClasses}`}>View models</p>
					</div>
				</div>
			) : (
				<div className="flex min-w-0 items-center gap-2 py-2">
					<div className="flex size-5 shrink-0 items-center justify-center">
						<CarrierMark
							src={src}
							alt={`${providerName} icon on ${theme} background`}
							className="size-4 object-contain"
						/>
					</div>
					<p className="truncate text-sm font-semibold">{providerName}</p>
				</div>
			)}
		</div>
	);
}

function AssetPreview({
	src,
	providerName,
	type,
	onRemove,
}: {
	src: string;
	providerName: string;
	type: "logo" | "icon";
	onRemove: () => void;
}) {
	const isLogo = type === "logo";

	return (
		<div className="border-border overflow-hidden rounded-lg border">
			<div className="flex items-start justify-between gap-3 p-3">
				<div>
					<p className="text-sm font-semibold">
						{isLogo ? "Provider logo" : "Square icon"}
					</p>
					<p className="text-muted-foreground text-xs">
						{isLogo ? "Provider directory card" : "Model card header"}
					</p>
				</div>
				<Button type="button" size="sm" variant="ghost" onClick={onRemove}>
					<X aria-hidden />
					Remove
				</Button>
			</div>
			<div className="grid grid-cols-2">
				<ThemePreview
					src={src}
					providerName={providerName}
					theme="light"
					type={type}
				/>
				<ThemePreview
					src={src}
					providerName={providerName}
					theme="dark"
					type={type}
				/>
			</div>
		</div>
	);
}

export function ProviderBrandingFields({
	logoInputId,
	iconInputId,
	providerName,
	logoUrl,
	iconUrl,
	onLogoChange,
	onIconChange,
}: {
	logoInputId: string;
	iconInputId: string;
	providerName: string;
	logoUrl?: string | null;
	iconUrl?: string | null;
	onLogoChange: (value: string | null) => void;
	onIconChange: (value: string | null) => void;
}) {
	const logoInput = useRef<HTMLInputElement>(null);
	const iconInput = useRef<HTMLInputElement>(null);
	const displayName = providerName.trim() || "Your provider";

	async function handleFile(
		input: HTMLInputElement,
		maxBytes: number,
		onChange: (value: string) => void,
	) {
		const file = input.files?.[0];
		if (!file) {
			return;
		}
		try {
			onChange(await readSvgAsDataUrl(file, maxBytes));
		} catch (error) {
			input.value = "";
			toast.error((error as Error).message);
		}
	}

	function removeLogo() {
		if (logoInput.current) {
			logoInput.current.value = "";
		}
		onLogoChange(null);
	}

	function removeIcon() {
		if (iconInput.current) {
			iconInput.current.value = "";
		}
		onIconChange(null);
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-2">
					<div>
						<Label htmlFor={logoInputId}>Provider logo</Label>
						<p
							id={`${logoInputId}-description`}
							className="text-muted-foreground mt-1 text-xs leading-relaxed"
						>
							Shown on provider directory cards and at the top of your provider
							page. Wide or horizontal SVGs work best. Max 200KB.
						</p>
					</div>
					<Input
						ref={logoInput}
						id={logoInputId}
						type="file"
						accept="image/svg+xml"
						aria-describedby={`${logoInputId}-description`}
						onChange={(event) =>
							void handleFile(event.currentTarget, LOGO_MAX_BYTES, onLogoChange)
						}
					/>
				</div>
				<div className="space-y-2">
					<div>
						<Label htmlFor={iconInputId}>Square icon</Label>
						<p
							id={`${iconInputId}-description`}
							className="text-muted-foreground mt-1 text-xs leading-relaxed"
						>
							Shown beside your provider name on compact model cards. Use a
							square SVG with a simple mark. Max 64KB.
						</p>
					</div>
					<Input
						ref={iconInput}
						id={iconInputId}
						type="file"
						accept="image/svg+xml"
						aria-describedby={`${iconInputId}-description`}
						onChange={(event) =>
							void handleFile(event.currentTarget, ICON_MAX_BYTES, onIconChange)
						}
					/>
				</div>
			</div>

			{logoUrl || iconUrl ? (
				<section className="space-y-3" aria-live="polite" aria-atomic="true">
					<div>
						<h3 className="text-sm font-semibold">Preview in context</h3>
						<p className="text-muted-foreground text-xs">
							Check how each asset reads on light and dark backgrounds.
						</p>
					</div>
					<div className="grid gap-3 lg:grid-cols-2">
						{logoUrl ? (
							<AssetPreview
								src={logoUrl}
								providerName={displayName}
								type="logo"
								onRemove={removeLogo}
							/>
						) : null}
						{iconUrl ? (
							<AssetPreview
								src={iconUrl}
								providerName={displayName}
								type="icon"
								onRemove={removeIcon}
							/>
						) : null}
					</div>
				</section>
			) : null}
		</div>
	);
}
