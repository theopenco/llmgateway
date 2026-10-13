"use client";

import { createContext, use, useEffect, useState } from "react";

import { CarrierMark } from "./carrier-mark";
import { Logo } from "./ui/logo";

import type { ReactNode, SVGProps } from "react";

type ProviderMarks = Readonly<Record<string, string>>;

const NO_MARKS: ProviderMarks = {};

const ProviderMarksContext = createContext<ProviderMarks>(NO_MARKS);

/**
 * Loads the marks Airside carriers uploaded, which `getProviderIcon` renders
 * for providers without a bundled icon.
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
				setMarks(data.marks);
			} catch (error) {
				// Icons fall back to the LLM Gateway logo until the next load.
				if (!controller.signal.aborted) {
					// eslint-disable-next-line no-console
					console.error("Failed to load provider marks:", error);
				}
			}
		})();
		return () => controller.abort();
	}, [apiUrl]);

	return <ProviderMarksContext value={marks}>{children}</ProviderMarksContext>;
}

/** A provider's uploaded mark, or the LLM Gateway logo when it has none. */
export function UploadedProviderMark({
	provider,
	className,
	...props
}: SVGProps<SVGSVGElement> & { provider: string }) {
	const marks = use(ProviderMarksContext);
	const mark = Object.hasOwn(marks, provider) ? marks[provider] : undefined;
	return mark ? (
		<CarrierMark src={mark} className={className} />
	) : (
		<Logo className={className} {...props} />
	);
}
