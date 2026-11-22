// DOM helpers behind the assistant's "show me where" tools. They read only
// what a user can see, and never the assistant's own dock.

const CONTROL_SELECTOR = [
	"[data-assistant-label]",
	"button",
	"a[href]",
	'[role="button"]',
	'[role="tab"]',
	'[role="menuitem"]',
	'[role="switch"]',
	'[role="combobox"]',
	"input:not([type=hidden])",
	"textarea",
	"select",
	"h1",
	"h2",
	"h3",
].join(",");

const MAX_LABEL_LENGTH = 80;

export interface PageControl {
	element: HTMLElement;
	label: string;
	kind: string;
}

function isVisible(element: HTMLElement): boolean {
	if (element.closest("[data-assistant-root],[aria-hidden=true],[inert]")) {
		return false;
	}
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) {
		return false;
	}
	const style = window.getComputedStyle(element);
	return style.visibility !== "hidden" && style.display !== "none";
}

function labelOf(element: HTMLElement): string {
	const fieldLabel =
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
			? (element.labels?.[0]?.textContent ??
				element.getAttribute("placeholder"))
			: null;
	const raw =
		element.dataset.assistantLabel ??
		element.getAttribute("aria-label") ??
		fieldLabel ??
		element.textContent ??
		element.getAttribute("title") ??
		"";
	return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

function kindOf(element: HTMLElement): string {
	const tag = element.tagName.toLowerCase();
	if (/^h[1-3]$/.test(tag)) {
		return "heading";
	}
	if (tag === "a") {
		return "link";
	}
	if (tag === "input" || tag === "textarea" || tag === "select") {
		return "field";
	}
	return element.getAttribute("role") ?? "button";
}

export function collectControls(): PageControl[] {
	const controls: PageControl[] = [];
	for (const element of Array.from(
		document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
	)) {
		if (!isVisible(element)) {
			continue;
		}
		const label = labelOf(element);
		if (label) {
			controls.push({ element, label, kind: kindOf(element) });
		}
	}
	return controls;
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function score(control: PageControl, query: string): number {
	const label = normalize(control.label);
	if (!label || !query) {
		return 0;
	}
	let points = 0;
	if (label === query) {
		points = 100;
	} else if (label.startsWith(query)) {
		points = 80;
	} else if (label.includes(query)) {
		points = 60;
	} else {
		const words = query.split(" ");
		const matched = words.filter((word) => label.includes(word)).length;
		if (matched * 2 < words.length) {
			return 0;
		}
		points = (matched / words.length) * 50;
	}
	// A control beats the heading above it, and the page beats the sidebar.
	if (control.kind !== "heading") {
		points += 5;
	}
	if (control.element.closest("main")) {
		points += 3;
	}
	return points;
}

export function findControl(query: string): PageControl | null {
	const normalized = normalize(query);
	let best: PageControl | null = null;
	let bestScore = 0;
	for (const control of collectControls()) {
		const points = score(control, normalized);
		if (points > bestScore) {
			best = control;
			bestScore = points;
		}
	}
	return best;
}

export function describePage(limit = 60) {
	const controls = collectControls();
	return {
		path: window.location.pathname,
		headings: unique(
			controls
				.filter((control) => control.kind === "heading")
				.map((control) => control.label),
		).slice(0, 20),
		controls: unique(
			controls
				.filter(
					(control) =>
						control.kind !== "heading" && control.element.closest("main"),
				)
				.map((control) => `${control.kind}: ${control.label}`),
		).slice(0, limit),
	};
}
