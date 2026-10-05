"use client";

import { subMinutes } from "date-fns";
import {
	Bell,
	Check,
	ChevronsUpDown,
	Megaphone,
	PanelLeftIcon,
	PlusCircle,
	Search,
	Settings2,
} from "lucide-react";
import { useState } from "react";

import {
	ANNOUNCEMENTS,
	DEMO_MODELS,
	DEMO_ORG,
	DEMO_PROJECTS,
	PROVIDER_NAMES,
	USAGE_ALERTS,
} from "@/components/home/dashboard-demo-data";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/lib/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { Separator } from "@/lib/components/separator";
import { LogoLockup } from "@/lib/icons/Logo";
import { cn } from "@/lib/utils";

import { READ_ONLY_MESSAGE, useDemo } from "./context";
import { isOrgView } from "./nav";
import { ProductSwitcherMenu } from "./sidebar";

export function SidebarTrigger({
	className,
	onClick,
}: {
	className?: string;
	onClick: () => void;
}) {
	return (
		<Button
			data-sidebar="trigger"
			variant="ghost"
			size="icon"
			className={cn("size-7", className)}
			onClick={onClick}
		>
			<PanelLeftIcon />
			<span className="sr-only">Toggle Sidebar</span>
		</Button>
	);
}

function ProjectSwitcher() {
	const { project, selectProject, notify } = useDemo();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					className="flex min-w-[180px] items-center justify-start gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
				>
					<span className="truncate">{project.name}</span>
					<ChevronsUpDown className="ml-auto h-4 w-4 flex-shrink-0 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-64 border-border bg-background text-foreground shadow-xl">
				<DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
					Projects in {DEMO_ORG.name}
				</DropdownMenuLabel>
				<DropdownMenuSeparator className="bg-border" />
				<DropdownMenuGroup>
					{DEMO_PROJECTS.map((item) => (
						<DropdownMenuItem
							key={item.id}
							onSelect={() => selectProject(item)}
							className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
						>
							<span className="truncate">{item.name}</span>
							{project.id === item.id && (
								<Check className="ml-auto h-4 w-4 flex-shrink-0" />
							)}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator className="bg-border" />
				<DropdownMenuItem
					onSelect={() => notify(READ_ONLY_MESSAGE)}
					className="cursor-pointer px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent"
				>
					<PlusCircle className="mr-2 h-4 w-4" />
					New Project
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ModelSearch() {
	const { navigate, track } = useDemo();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const query = search.trim().toLowerCase();
	const results = query
		? DEMO_MODELS.filter((model) =>
				[model.id, model.name, ...model.providers].some((field) =>
					field.toLowerCase().includes(query),
				),
			)
		: DEMO_MODELS;

	return (
		<Popover
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) {
					setSearch("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<Search className="h-3.5 w-3.5 shrink-0" />
					<span className="truncate">
						Search models by provider, name, ID, or alias…
					</span>
					<span className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
						⌘K
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-[min(480px,90vw)] p-0"
				side="bottom"
				align="center"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search models…"
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList className="max-h-[400px]">
						<CommandEmpty>No results found.</CommandEmpty>
						{results.length > 0 && (
							<CommandGroup heading="Models">
								{results.map((model) => (
									<CommandItem
										key={model.id}
										value={model.id}
										onSelect={() => {
											setOpen(false);
											setSearch("");
											track("model_search", model.id);
											navigate("model-usage");
										}}
									>
										<div className="flex w-full min-w-0 items-center gap-3">
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
												<span className="text-xs font-medium uppercase text-muted-foreground">
													{model.name.charAt(0)}
												</span>
											</div>
											<div className="flex min-w-0 flex-col items-start">
												<span className="max-w-full truncate text-sm font-medium">
													{model.name}
												</span>
												<span className="max-w-full truncate text-xs text-muted-foreground">
													{model.id} ·{" "}
													{model.providers
														.map(
															(provider) =>
																PROVIDER_NAMES[provider] ?? provider,
														)
														.slice(0, 2)
														.join(", ")}
												</span>
											</div>
										</div>
									</CommandItem>
								))}
							</CommandGroup>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function ChangelogNotifications() {
	const [open, setOpen] = useState(false);
	const [seen, setSeen] = useState(false);

	return (
		<Popover
			open={open}
			onOpenChange={(value) => {
				setOpen(value);
				if (value) {
					setSeen(true);
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={
						seen
							? "Changelog notifications"
							: `${ANNOUNCEMENTS.length} unread announcements`
					}
					className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
				>
					<Megaphone className="h-[18px] w-[18px]" />
					{!seen && (
						<span className="absolute right-1.5 top-1.5 flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[min(360px,calc(100vw-24px))] p-0"
				sideOffset={8}
			>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h3 className="text-sm font-semibold tracking-tight">
						What&apos;s New
					</h3>
				</div>
				<div className="max-h-[320px] divide-y divide-border overflow-y-auto">
					{ANNOUNCEMENTS.map((entry) => (
						<div key={entry.slug} className="block px-4 py-3">
							<div className="flex items-center gap-2">
								<time className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
									{new Date(`${entry.date}T00:00:00`).toLocaleDateString(
										"en-US",
										{ month: "short", day: "numeric" },
									)}
								</time>
								<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									{entry.type === "blog" ? "Blog" : "Update"}
								</span>
							</div>
							<p className="mt-1 text-sm font-medium leading-snug">
								{entry.title}
							</p>
							<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
								{entry.summary}
							</p>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function UsageNotifications() {
	const { navigate, openedAt } = useDemo();
	const [open, setOpen] = useState(false);
	const [readIds, setReadIds] = useState<string[]>([]);
	const isUnread = (alert: (typeof USAGE_ALERTS)[number]) =>
		alert.unread && !readIds.includes(alert.id);
	const unread = USAGE_ALERTS.filter(isUnread).length;
	const dateFormat = new Intl.DateTimeFormat("en-US", {
		month: "numeric",
		day: "numeric",
		year: "numeric",
	});

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="relative h-9 w-9"
					aria-label={
						unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
					}
				>
					<Bell className="h-[18px] w-[18px]" />
					{unread > 0 && (
						<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[min(420px,calc(100vw-24px))] p-0"
			>
				<div className="flex items-center justify-between border-b p-4">
					<h3 className="font-semibold">Notifications</h3>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label="Notification settings"
						onClick={() => {
							setOpen(false);
							navigate("org/notifications");
						}}
					>
						<Settings2 className="h-4 w-4" />
					</Button>
				</div>
				<div className="max-h-[400px] overflow-y-auto">
					{USAGE_ALERTS.map((alert) => (
						<div
							key={alert.id}
							className={`block space-y-1 border-b p-4 hover:bg-muted/50 ${isUnread(alert) ? "bg-primary/5" : ""}`}
						>
							<p className="text-sm font-medium">
								{isUnread(alert) && (
									<span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
								)}
								{alert.title}
							</p>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{alert.message}
							</p>
							<time className="text-xs text-muted-foreground">
								{dateFormat.format(subMinutes(openedAt, alert.agoMinutes))}
							</time>
						</div>
					))}
				</div>
				{unread > 0 && (
					<div className="p-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setReadIds(USAGE_ALERTS.map((alert) => alert.id))}
						>
							Mark all as read
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

export function DemoTopBar({
	onToggleSidebar,
}: {
	onToggleSidebar: () => void;
}) {
	const { view } = useDemo();

	return (
		<header className="z-30 flex h-16 flex-shrink-0 items-center gap-2 border-b border-border bg-background px-4 @xl/demo:px-6">
			<SidebarTrigger
				className="hidden @3xl/demo:flex"
				onClick={onToggleSidebar}
			/>
			<Separator
				orientation="vertical"
				className="mr-2 hidden h-4 @3xl/demo:block"
			/>
			{!isOrgView(view) && <ProjectSwitcher />}
			<div className="ml-auto flex items-center gap-2">
				<div className="hidden w-[160px] @lg/demo:block @xl/demo:w-[200px]">
					<ModelSearch />
				</div>
				<ChangelogNotifications />
				<UsageNotifications />
				<ThemeToggle size="compact" className="hidden @3xl/demo:inline-flex" />
			</div>
		</header>
	);
}

export function DemoMobileHeader({
	onOpenSidebar,
}: {
	onOpenSidebar: () => void;
}) {
	return (
		<header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4 @3xl/demo:hidden">
			<SidebarTrigger onClick={onOpenSidebar} />
			<ProductSwitcherMenu side="bottom">
				<button
					type="button"
					className="flex min-w-0 shrink-0 items-center gap-3 rounded-lg px-2 py-2 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
				>
					<LogoLockup className="h-6 w-auto" />
					<ChevronsUpDown
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
				</button>
			</ProductSwitcherMenu>
			<div className="flex flex-1 items-center justify-end gap-2">
				<ModeToggle />
			</div>
		</header>
	);
}
