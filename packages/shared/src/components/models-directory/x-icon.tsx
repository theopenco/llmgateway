import { cn } from "@/lib/utils";

export function XIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("h-4 w-4 text-current", className)}
			strokeLinejoin="round"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M1.60022 2H5.80022L8.78759 6.16842L12.4002 2H14.0002L9.5118 7.17895L14.4002 14H10.2002L7.21285 9.83158L3.60022 14H2.00022L6.48864 8.82105L1.60022 2ZM10.8166 12.8L3.93657 3.2H5.18387L12.0639 12.8H10.8166Z"
			/>
		</svg>
	);
}
