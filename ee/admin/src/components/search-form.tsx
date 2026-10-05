"use client";

import { useRouter } from "next/navigation";

import type { FormEvent, ReactNode } from "react";

/**
 * A query param in emitted order. With `value` it is always emitted;
 * without, it is read from the form field of the same name and omitted
 * when empty.
 */
export interface SearchFormParam {
	name: string;
	value?: string;
}

export function SearchForm({
	pathname,
	params,
	encoding = "uri",
	className,
	children,
}: {
	pathname: string;
	params: SearchFormParam[];
	/** "form" encodes like URLSearchParams (spaces as `+`). */
	encoding?: "uri" | "form";
	className?: string;
	children: ReactNode;
}) {
	const router = useRouter();

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const entries: [string, string][] = [];
		for (const param of params) {
			const value = param.value ?? String(formData.get(param.name) ?? "");
			if (param.value !== undefined || value) {
				entries.push([param.name, value]);
			}
		}
		const query =
			encoding === "form"
				? new URLSearchParams(entries).toString()
				: entries
						.map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
						.join("&");
		router.push(`${pathname}?${query}`);
	};

	return (
		<form onSubmit={handleSubmit} className={className}>
			{children}
		</form>
	);
}
