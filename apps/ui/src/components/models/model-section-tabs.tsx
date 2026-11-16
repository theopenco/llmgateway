"use client";

import { MotionConfig, motion } from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { cn } from "@/lib/utils";

import type { MouseEvent, ReactNode } from "react";

export interface ModelSection {
	id: string;
	label: string;
	content: ReactNode;
}

const HASH_EVENT = "hashchange";

function subscribeToHash(onChange: () => void) {
	window.addEventListener(HASH_EVENT, onChange);
	return () => window.removeEventListener(HASH_EVENT, onChange);
}

function readHash() {
	return window.location.hash.slice(1);
}

function readServerHash() {
	return "";
}

function isPlainClick(event: MouseEvent) {
	return (
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

export function ModelSectionTabs({ sections }: { sections: ModelSection[] }) {
	const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
	const [animatePanels, setAnimatePanels] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const active =
		sections.find((section) => section.id === hash)?.id ?? sections[0]?.id;

	useEffect(() => {
		const list = listRef.current;
		const initial = window.location.hash;
		if (initial && list?.querySelector(`a[href="${CSS.escape(initial)}"]`)) {
			list.scrollIntoView({ block: "start" });
		}
	}, []);

	const select = (id: string) => {
		if (id === active) {
			return;
		}
		setAnimatePanels(true);
		window.history.replaceState(window.history.state, "", `#${id}`);
		window.dispatchEvent(new HashChangeEvent(HASH_EVENT));
	};

	return (
		<MotionConfig reducedMotion="user">
			<Tabs value={active} onValueChange={select} className="gap-8">
				<TabsList
					ref={listRef}
					aria-label="Model sections"
					className="h-auto w-full scroll-mt-28 justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0"
				>
					{sections.map((section) => (
						<TabsTrigger
							key={section.id}
							value={section.id}
							asChild
							className="relative h-auto flex-none rounded-none border-0 px-3 py-2 font-normal text-muted-foreground shadow-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-inset data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:text-muted-foreground dark:data-[state=active]:bg-transparent"
						>
							<a
								href={`#${section.id}`}
								onClick={(event) => {
									if (isPlainClick(event)) {
										event.preventDefault();
									}
								}}
							>
								{section.label}
								{section.id === active && (
									<motion.span
										layoutId="model-section-tab-indicator"
										aria-hidden
										className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground"
										transition={{ type: "spring", duration: 0.3, bounce: 0 }}
									/>
								)}
							</a>
						</TabsTrigger>
					))}
				</TabsList>
				{sections.map((section) => (
					<TabsContent
						key={section.id}
						value={section.id}
						forceMount
						className={cn(
							"mb-8 data-[state=inactive]:hidden",
							animatePanels &&
								"data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none",
						)}
					>
						{section.content}
					</TabsContent>
				))}
			</Tabs>
		</MotionConfig>
	);
}
