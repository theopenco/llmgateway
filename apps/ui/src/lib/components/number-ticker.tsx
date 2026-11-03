"use client";

import { useInView, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { ComponentPropsWithoutRef } from "react";

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
	value: number;
	startValue?: number;
	direction?: "up" | "down";
	delay?: number;
	decimalPlaces?: number;
}

export function NumberTicker({
	value,
	startValue = 0,
	direction = "up",
	delay = 0,
	className,
	decimalPlaces = 0,
	...props
}: NumberTickerProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const motionValue = useMotionValue(direction === "down" ? value : startValue);
	const springValue = useSpring(motionValue, {
		damping: 60,
		stiffness: 100,
	});
	const isInView = useInView(ref, { once: true, margin: "0px" });

	useEffect(() => {
		if (isInView) {
			const timer = setTimeout(() => {
				motionValue.set(direction === "down" ? startValue : value);
			}, delay * 1000);
			return () => clearTimeout(timer);
		}

		return () => {};
	}, [motionValue, isInView, delay, value, direction, startValue]);

	useEffect(() => {
		// One formatter per subscription — the spring change handler fires every
		// animation frame, so it must not construct an Intl.NumberFormat each call.
		// Built on the first change rather than on mount: the first Intl object
		// is slow to create, and most tickers sit below the fold during hydration.
		let format: Intl.NumberFormat | undefined;
		return springValue.on("change", (latest) => {
			if (ref.current) {
				format ??= new Intl.NumberFormat("en-US", {
					minimumFractionDigits: decimalPlaces,
					maximumFractionDigits: decimalPlaces,
				});
				ref.current.textContent = format.format(
					Number(latest.toFixed(decimalPlaces)),
				);
			}
		});
	}, [springValue, decimalPlaces]);

	return (
		<span
			ref={ref}
			className={cn(
				"inline-block tracking-wider text-black tabular-nums dark:text-white",
				className,
			)}
			{...props}
		>
			{startValue}
		</span>
	);
}
