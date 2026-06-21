import { getBrand } from "@/components/compare/brand-icons";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

interface TileProps {
	size?: number;
	radius?: number;
	className?: string;
}

export function UsTile({ size = 44, radius = 12, className }: TileProps) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center bg-foreground text-background",
				className,
			)}
			style={{ width: size, height: size, borderRadius: radius }}
			aria-label="LLM Gateway Chat"
		>
			<Logo style={{ width: size * 0.42, height: size * 0.42 }} />
		</div>
	);
}

interface ThemTileProps extends TileProps {
	slug: string;
	competitor: string;
}

export function ThemTile({
	slug,
	competitor,
	size = 44,
	radius = 12,
	className,
}: ThemTileProps) {
	const brand = getBrand(slug);

	if (brand?.mode === "tile") {
		const { Icon } = brand;
		return (
			<div
				className={cn(
					"flex shrink-0 items-center justify-center overflow-hidden border border-border/60",
					className,
				)}
				style={{ width: size, height: size, borderRadius: radius }}
				aria-label={competitor}
			>
				<Icon style={{ width: size, height: size }} />
			</div>
		);
	}

	if (brand?.mode === "mark") {
		const { Icon, colorClass } = brand;
		return (
			<div
				className={cn(
					"flex shrink-0 items-center justify-center border border-border/60 bg-background",
					className,
				)}
				style={{ width: size, height: size, borderRadius: radius }}
				aria-label={competitor}
			>
				<Icon
					className={colorClass}
					style={{
						width: Math.round(size * 0.6),
						height: Math.round(size * 0.6),
					}}
				/>
			</div>
		);
	}

	// Fallback: initials chip if a brand logo isn't registered.
	const initials = competitor
		.replace(/[^A-Za-z0-9]/g, "")
		.slice(0, 2)
		.toUpperCase();
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center border border-border/60 bg-muted font-bold tracking-tight text-muted-foreground",
				className,
			)}
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				fontSize: size * 0.32,
			}}
			aria-label={competitor}
		>
			{initials}
		</div>
	);
}

interface FaceOffProps extends TileProps {
	slug: string;
	competitor: string;
}

export function FaceOff({
	slug,
	competitor,
	size = 44,
	radius = 12,
}: FaceOffProps) {
	return (
		<div className="flex items-center gap-3">
			<UsTile size={size} radius={radius} />
			<span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
				vs
			</span>
			<ThemTile
				slug={slug}
				competitor={competitor}
				size={size}
				radius={radius}
			/>
		</div>
	);
}
