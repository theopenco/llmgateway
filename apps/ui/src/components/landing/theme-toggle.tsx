import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface ThemeToggleProps {
	className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
	const { theme, setTheme, systemTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	// Use theme if available, fallback to systemTheme, then default to light
	const currentTheme = theme === "system" ? systemTheme : theme;
	const isDark = currentTheme === "dark";

	useEffect(() => {
		setMounted(true);
	}, []);

	// Prevent hydration mismatch by showing a neutral state until mounted
	if (!mounted) {
		return (
			<div
				className={cn(
					"flex w-16 h-8 p-1 rounded-full cursor-pointer transition-all duration-300",
					"bg-white border border-zinc-200",
					className,
				)}
				role="button"
				tabIndex={0}
			>
				<div className="flex justify-between items-center w-full">
					<div className="flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300 transform translate-x-8 bg-gray-200">
						<Sun className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
					</div>
					<div className="flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300 transform -translate-x-8">
						<Moon className="w-4 h-4 text-black" strokeWidth={1.5} />
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex w-16 h-8 p-1 rounded-full cursor-pointer transition-all duration-300",
				isDark
					? "bg-zinc-950 border border-zinc-800"
					: "bg-white border border-zinc-200",
				className,
			)}
			onClick={() => setTheme(isDark ? "light" : "dark")}
			role="button"
			tabIndex={0}
		>
			<div className="flex justify-between items-center w-full">
				<div
					className={cn(
						"flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300",
						isDark
							? "transform translate-x-0 bg-zinc-800"
							: "transform translate-x-8 bg-gray-200",
					)}
				>
					{isDark ? (
						<Moon className="w-4 h-4 text-white" strokeWidth={1.5} />
					) : (
						<Sun className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
					)}
				</div>
				<div
					className={cn(
						"flex justify-center items-center w-6 h-6 rounded-full transition-transform duration-300",
						isDark ? "bg-transparent" : "transform -translate-x-8",
					)}
				>
					{isDark ? (
						<Sun className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
					) : (
						<Moon className="w-4 h-4 text-black" strokeWidth={1.5} />
					)}
				</div>
			</div>
		</div>
	);
}
