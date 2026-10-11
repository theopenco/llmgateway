"use client";

import { ImageUp, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

function UploadTile({
	inputId,
	title,
	usage,
	hint,
	maxBytes,
	src,
	providerName,
	kind,
	onChange,
}: {
	inputId: string;
	title: string;
	usage: string;
	hint: string;
	maxBytes: number;
	src?: string | null;
	providerName: string;
	kind: "logo" | "icon";
	onChange: (value: string | null) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const descriptionId = `${inputId}-description`;

	async function accept(file: File | undefined) {
		if (!file) {
			return;
		}
		try {
			onChange(await readSvgAsDataUrl(file, maxBytes));
		} catch (error) {
			toast.error((error as Error).message);
		} finally {
			if (input.current) {
				input.current.value = "";
			}
		}
	}

	const markClass =
		kind === "logo" ? "h-10 w-28 object-contain" : "size-8 object-contain";

	return (
		<div
			className={cn(
				"border-border bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border transition-colors",
				dragging && "border-primary bg-primary/5",
			)}
			data-testid={`${inputId}-tile`}
			onDragOver={(event) => {
				event.preventDefault();
				setDragging(true);
			}}
			onDragLeave={() => setDragging(false)}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				void accept(event.dataTransfer.files[0]);
			}}
		>
			<div className="grid h-24 grid-cols-2" aria-live="polite">
				{(["light", "dark"] as const).map((theme) => (
					<div
						key={theme}
						className={cn(
							"flex items-center justify-center",
							theme === "light"
								? "bg-white text-slate-950"
								: "bg-slate-950 text-slate-50",
						)}
					>
						{src ? (
							<CarrierMark
								src={src}
								alt={`${providerName} ${kind} on ${theme} background`}
								className={markClass}
							/>
						) : (
							<ImageUp
								aria-hidden
								className={cn(
									"size-6",
									theme === "light" ? "text-slate-300" : "text-slate-600",
								)}
							/>
						)}
					</div>
				))}
			</div>
			<div className="flex flex-1 flex-col gap-3 border-t p-3">
				<div>
					<label htmlFor={inputId} className="text-sm font-semibold">
						{title}
					</label>
					<p
						id={descriptionId}
						className="text-muted-foreground mt-0.5 text-xs leading-relaxed"
					>
						{usage}{" "}
						<span className="font-mono text-[0.65rem] tracking-wide uppercase">
							{hint}
						</span>
					</p>
				</div>
				<input
					ref={input}
					id={inputId}
					type="file"
					accept="image/svg+xml"
					className="sr-only"
					aria-describedby={descriptionId}
					onChange={(event) => void accept(event.currentTarget.files?.[0])}
				/>
				<div className="mt-auto flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						variant={src ? "outline" : "default"}
						onClick={() => input.current?.click()}
						data-testid={`${inputId}-upload`}
					>
						{src ? <RefreshCw aria-hidden /> : <ImageUp aria-hidden />}
						{src ? "Replace" : "Upload SVG"}
					</Button>
					{src ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => onChange(null)}
							data-testid={`${inputId}-remove`}
						>
							<Trash2 aria-hidden />
							Remove
						</Button>
					) : null}
				</div>
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
	const displayName = providerName.trim() || "Your provider";

	return (
		<div className="grid gap-3 sm:grid-cols-2">
			<UploadTile
				inputId={logoInputId}
				title="Provider logo"
				usage="Directory cards and the top of your provider page. Wide marks work best."
				hint="SVG · max 200KB"
				maxBytes={LOGO_MAX_BYTES}
				src={logoUrl}
				providerName={displayName}
				kind="logo"
				onChange={onLogoChange}
			/>
			<UploadTile
				inputId={iconInputId}
				title="Square icon"
				usage="Beside your name on compact model cards. Use a simple square mark."
				hint="SVG · square · max 64KB"
				maxBytes={ICON_MAX_BYTES}
				src={iconUrl}
				providerName={displayName}
				kind="icon"
				onChange={onIconChange}
			/>
		</div>
	);
}
