"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Headings inside an inactive fumadocs <Tab> are hidden, so hash links to them
// (TOC clicks, shared URLs) cannot scroll. Open every enclosing tab first.
function revealAnchor(id: string): boolean {
	const target = document.getElementById(id);
	if (!target) {
		return false;
	}
	let opened = false;
	let panel = target.closest<HTMLElement>(
		'[role="tabpanel"][data-state="inactive"]',
	);
	while (panel) {
		const trigger = document.querySelector<HTMLElement>(
			`[role="tab"][aria-controls="${CSS.escape(panel.id)}"]`,
		);
		if (!trigger) {
			break;
		}
		trigger.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		opened = true;
		panel =
			panel.parentElement?.closest<HTMLElement>(
				'[role="tabpanel"][data-state="inactive"]',
			) ?? null;
	}
	if (!opened) {
		return false;
	}
	requestAnimationFrame(() => {
		requestAnimationFrame(() => target.scrollIntoView());
	});
	return true;
}

function hashId(hash: string): string {
	return decodeURIComponent(hash.slice(1));
}

export function TabAnchorHandler() {
	const pathname = usePathname();

	useEffect(() => {
		if (window.location.hash) {
			revealAnchor(hashId(window.location.hash));
		}
	}, [pathname]);

	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) {
				return;
			}
			const link = (event.target as Element | null)?.closest("a");
			if (!link) {
				return;
			}
			const url = new URL(link.href, window.location.href);
			if (
				!url.hash ||
				url.origin !== window.location.origin ||
				url.pathname !== window.location.pathname
			) {
				return;
			}
			if (revealAnchor(hashId(url.hash))) {
				event.preventDefault();
				window.history.pushState(null, "", url.hash);
			}
		};
		const onHashChange = () => revealAnchor(hashId(window.location.hash));
		document.addEventListener("click", onClick);
		window.addEventListener("hashchange", onHashChange);
		return () => {
			document.removeEventListener("click", onClick);
			window.removeEventListener("hashchange", onHashChange);
		};
	}, []);

	return null;
}
