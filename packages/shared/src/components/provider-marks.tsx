"use client";

import {
	createContext,
	startTransition,
	use,
	useEffect,
	useState,
} from "react";

import { CarrierMark } from "./carrier-mark";

import type { ReactNode } from "react";

type ProviderMarks = Readonly<Record<string, string>>;

const NO_MARKS: ProviderMarks = {};

const ProviderMarksContext = createContext<ProviderMarks>(NO_MARKS);

/**
 * Loads the marks Airside carriers uploaded, which `getProviderIcon` and
 * `providerLogoUrls` render in place of the bundled icon.
 */
export function ProviderMarksProvider({
	apiUrl,
	children,
}: {
	apiUrl: string;
	children: ReactNode;
}) {
	const [marks, setMarks] = useState<ProviderMarks>(NO_MARKS);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			try {
				const res = await fetch(`${apiUrl}/internal/provider-marks`, {
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const data = (await res.json()) as { marks: ProviderMarks };
				// A transition: this context wraps the whole page, and an urgent
				// change forces every Suspense boundary still waiting to hydrate to
				// do so in one blocking task.
				startTransition(() => setMarks(data.marks));
			} catch (error) {
				// Non-fatal: icons fall back to the bundled logos, so warn instead
				// of raising the dev error overlay when the API is unreachable.
				if (!controller.signal.aborted) {
					// eslint-disable-next-line no-console
					console.warn("Provider marks unavailable:", error);
				}
			}
		})();
		return () => controller.abort();
	}, [apiUrl]);

	return <ProviderMarksContext value={marks}>{children}</ProviderMarksContext>;
}

/**
 * A provider's uploaded mark, else `children` (its fallback icon). The
 * fallback is passed as an element so server components can render this.
 */
export function ProviderMark({
	provider,
	className,
	children,
}: {
	provider: string;
	className?: string;
	children: ReactNode;
}) {
	const marks = use(ProviderMarksContext);
	const mark = Object.hasOwn(marks, provider) ? marks[provider] : undefined;
	return mark ? <CarrierMark src={mark} className={className} /> : children;
}
