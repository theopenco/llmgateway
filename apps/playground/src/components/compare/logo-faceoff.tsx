import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

interface ThemTileProps {
	monogram: string;
	tileClass: string;
	size?: number;
	radius?: number;
	className?: string;
}

export function UsTile({
	size = 44,
	radius = 12,
	className,
}: {
	size?: number;
	radius?: number;
	className?: string;
}) {
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

export function ThemTile({
	monogram,
	tileClass,
	size = 44,
	radius = 12,
	className,
}: ThemTileProps) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center font-bold tracking-tight",
				tileClass,
				className,
			)}
			style={{
				width: size,
				height: size,
				borderRadius: radius,
				fontSize: size * 0.34,
			}}
			aria-hidden
		>
			{monogram}
		</div>
	);
}

interface FaceOffProps {
	monogram: string;
	tileClass: string;
	size?: number;
	radius?: number;
}

export function FaceOff({
	monogram,
	tileClass,
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
				monogram={monogram}
				tileClass={tileClass}
				size={size}
				radius={radius}
			/>
		</div>
	);
}
