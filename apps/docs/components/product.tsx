import { icons } from "lucide-react";
import Link from "next/link";

import { ThemedImage } from "@/components/themed-image";
import { TrackedLink } from "@/components/tracked-link";
import { productOrder, products } from "@/lib/products";

import type { ProductId } from "@/lib/products";
import type { CSSProperties, ReactNode } from "react";

const productIcons: Record<ProductId, keyof typeof icons> = {
	gateway: "Network",
	devpass: "SquareTerminal",
	lounge: "Armchair",
	airside: "PlaneTakeoff",
};

function ProductIcon({
	product,
	className,
}: {
	product: ProductId;
	className?: string;
}) {
	const Icon = icons[productIcons[product]];
	return <Icon className={className} aria-hidden />;
}

function accentStyle(product: ProductId): CSSProperties {
	return { "--product-accent": products[product].accent } as CSSProperties;
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
	return (
		<figure className="not-prose my-0 overflow-hidden rounded-xl border bg-fd-card shadow-sm">
			<div className="flex items-center gap-1.5 border-b bg-fd-muted/60 px-3 py-2">
				<span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
				<span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
				<span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
				<span className="ml-2 truncate font-mono text-[11px] text-fd-muted-foreground">
					{label}
				</span>
			</div>
			<div className="[&_img]:rounded-none [&_img]:border-0">{children}</div>
		</figure>
	);
}

export function ProductHero({
	product,
	screenshot,
	screenshotAlt,
	screenshotLabel,
	width = 1440,
	height = 900,
	quickStart,
}: {
	product: ProductId;
	screenshot: string;
	screenshotAlt: string;
	screenshotLabel: string;
	width?: number;
	height?: number;
	quickStart?: string;
}) {
	const p = products[product];
	return (
		<div
			className="not-prose my-6 flex flex-col gap-5"
			style={accentStyle(product)}
		>
			<div className="flex flex-wrap items-center gap-3">
				<TrackedLink
					href={p.appUrl}
					event="docs_product_app_click"
					properties={{ product: p.id }}
					className="inline-flex items-center gap-1.5 rounded-full bg-[var(--product-accent)] px-3.5 py-1.5 text-xs font-semibold text-[#09090b] transition-opacity hover:opacity-90"
				>
					{p.appLabel}
					<icons.ArrowUpRight className="size-3.5" aria-hidden />
				</TrackedLink>
				{quickStart ? (
					<Link
						href={quickStart}
						className="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
					>
						Quick start
						{quickStart.startsWith("#") ? (
							<icons.ArrowDown className="size-3.5" aria-hidden />
						) : (
							<icons.ArrowRight className="size-3.5" aria-hidden />
						)}
					</Link>
				) : null}
			</div>
			<Frame label={screenshotLabel}>
				<ThemedImage
					alt={screenshotAlt}
					basePath={screenshot}
					width={width}
					height={height}
				/>
			</Frame>
		</div>
	);
}

export function Recording({
	src,
	label,
	title,
}: {
	src: string;
	label: string;
	title: string;
}) {
	return (
		<div className="not-prose my-6">
			<Frame label={label}>
				<video
					src={src}
					title={title}
					aria-label={title}
					autoPlay
					muted
					loop
					playsInline
					controls
					preload="metadata"
					className="block aspect-[16/10] w-full bg-fd-muted"
				/>
			</Frame>
		</div>
	);
}

export interface SectionLink {
	title: string;
	description: string;
	href: string;
	icon: keyof typeof icons;
}

export function SectionCards({
	product,
	links,
}: {
	product: ProductId;
	links: SectionLink[];
}) {
	return (
		<div
			className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2"
			style={accentStyle(product)}
		>
			{links.map((link) => {
				const Icon = icons[link.icon];
				return (
					<TrackedLink
						key={link.href}
						href={link.href}
						event="docs_product_section_click"
						properties={{ product, href: link.href }}
						className="group flex gap-3 rounded-xl border bg-fd-card p-4 transition-colors hover:border-[var(--product-accent)]"
					>
						<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--product-accent)_12%,transparent)] text-[var(--product-accent)]">
							<Icon className="size-4.5" aria-hidden />
						</span>
						<span className="flex min-w-0 flex-col gap-1">
							<span className="text-sm font-semibold text-fd-foreground">
								{link.title}
							</span>
							<span className="text-[13px] leading-relaxed text-fd-muted-foreground">
								{link.description}
							</span>
						</span>
					</TrackedLink>
				);
			})}
		</div>
	);
}

export function ProductCards({ exclude }: { exclude?: ProductId }) {
	return (
		<div className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2">
			{productOrder
				.filter((id) => id !== exclude)
				.map((id) => {
					const p = products[id];
					return (
						<TrackedLink
							key={id}
							href={p.docsUrl}
							event="docs_product_card_click"
							properties={{ product: id }}
							style={accentStyle(id)}
							className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-fd-card p-5 transition-colors hover:border-[var(--product-accent)]"
						>
							<span className="absolute inset-x-0 top-0 h-0.5 bg-[var(--product-accent)] opacity-60 transition-opacity group-hover:opacity-100" />
							<span className="flex items-center gap-2.5">
								<span className="flex size-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--product-accent)_14%,transparent)] text-[var(--product-accent)]">
									<ProductIcon product={id} className="size-4" />
								</span>
								<span className="text-base font-semibold tracking-tight text-fd-foreground">
									{p.name}
								</span>
								<icons.ArrowRight
									className="ml-auto size-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--product-accent)]"
									aria-hidden
								/>
							</span>
							<span className="text-[13px] leading-relaxed text-fd-muted-foreground">
								{p.tagline}
							</span>
						</TrackedLink>
					);
				})}
		</div>
	);
}
