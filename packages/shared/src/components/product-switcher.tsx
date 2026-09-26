"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { AirsideLogo, DevPassLogo, LoungeLogo } from "./product-logos";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Logo, LogoLockup } from "./ui/logo";

import type { ReactElement } from "react";

const products = [
	{
		id: "gateway",
		name: "LLM Gateway",
		description: "API routing and usage",
		icon: Logo,
	},
	{
		id: "devpass",
		name: "DevPass",
		description: "Plans for coding agents",
		icon: DevPassLogo,
	},
	{
		id: "airside",
		name: "Airside",
		description: "Serve models as a carrier",
		icon: AirsideLogo,
	},
	{
		id: "lounge",
		name: "The Lounge",
		description: "Chat and create with AI",
		icon: LoungeLogo,
	},
] as const;

export type ProductId = (typeof products)[number]["id"];

interface ProductSwitcherProps {
	current: ProductId;
	urls: Record<ProductId, string>;
	children?: ReactElement;
	side?: "bottom" | "right";
	className?: string;
}

export function ProductIdentity({
	product,
	className,
}: {
	product: ProductId;
	className?: string;
}) {
	const entry = products.find((item) => item.id === product)!;
	return (
		<span className={cn("flex min-w-0 items-center gap-2", className)}>
			{product === "gateway" ? (
				<LogoLockup className="h-6 w-auto" />
			) : (
				<>
					<entry.icon className="size-7 shrink-0" />
					<span className="truncate text-base font-semibold tracking-tight">
						{entry.name}
					</span>
				</>
			)}
		</span>
	);
}

export function ProductSwitcher({
	current,
	urls,
	children,
	side = "bottom",
	className,
}: ProductSwitcherProps) {
	const name = products.find((product) => product.id === current)!.name;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				asChild
				aria-label={`Switch product, current product ${name}`}
			>
				{children ?? (
					<button
						type="button"
						className={cn(
							"flex min-w-0 shrink-0 items-center gap-3 rounded-lg px-2 py-2 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
							className,
						)}
					>
						<ProductIdentity product={current} />
						<ChevronsUpDown
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					</button>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side={side}
				align="start"
				sideOffset={6}
				collisionPadding={16}
				className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-2"
			>
				<DropdownMenuLabel className="px-2 pb-2 text-xs font-medium text-muted-foreground">
					Switch product
				</DropdownMenuLabel>
				{products.map((product) => (
					<DropdownMenuItem key={product.id} asChild className="rounded-lg p-2">
						<Link
							href={urls[product.id]}
							prefetch={false}
							aria-current={product.id === current ? "page" : undefined}
						>
							<span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
								<product.icon
									className="size-6 text-foreground"
									aria-hidden="true"
								/>
							</span>
							<span className="min-w-0 flex-1">
								<span className="block font-medium">{product.name}</span>
								<span className="block text-xs text-muted-foreground">
									{product.description}
								</span>
							</span>
							{product.id === current && (
								<Check
									className="size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
							)}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
