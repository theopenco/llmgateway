import { cn } from "@/lib/utils";

import { AirworthyStamp } from "@llmgateway/shared/components";

const FIELDS: { box: string; label: string; value: string; wide?: boolean }[] =
	[
		{ box: "1", label: "Carrier", value: "EMBERCLOUD INFERENCE", wide: true },
		{ box: "2", label: "Legal entity", value: "Embercloud Labs B.V." },
		{ box: "3", label: "Headquarters", value: "NL — Netherlands" },
		{ box: "4", label: "Trains on API data", value: "NO" },
		{ box: "5", label: "Logs prompts", value: "NO" },
		{ box: "6", label: "Retention", value: "ZERO DAYS" },
		{ box: "7", label: "GDPR", value: "DPA + SCCs" },
		{ box: "8", label: "SOC 2", value: "TYPE II" },
		{ box: "9", label: "ISO 27001", value: "CERTIFIED" },
	];

/**
 * A specimen Airworthy certificate, styled after a paper airworthiness form:
 * numbered boxes, a serial, and the stamp pressed on last.
 */
export function CertificateSpecimen({ className }: { className?: string }) {
	return (
		<figure
			className={cn(
				"relative mx-auto w-full max-w-md select-none [--ink:oklch(0.27_0.05_255)] [--paper:oklch(0.975_0.012_85)] [--stamp:oklch(0.56_0.16_45)]",
				className,
			)}
			aria-label="Specimen Airworthy certificate"
		>
			<div className="bg-primary/25 absolute inset-0 translate-x-3 translate-y-3 rotate-2 rounded-sm blur-2xl" />
			<div className="relative rotate-[-1.5deg] rounded-sm bg-[var(--paper)] p-5 text-[var(--ink)] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.45)] sm:p-7">
				<div className="pointer-events-none absolute inset-2 rounded-[2px] border border-[var(--ink)]/25" />
				<div className="pointer-events-none absolute inset-3 rounded-[2px] border border-dashed border-[var(--ink)]/15" />
				<div className="relative flex items-start justify-between gap-4 border-b-2 border-[var(--ink)] pb-3">
					<div>
						<div className="font-mono text-[0.6rem] tracking-[0.3em] uppercase opacity-70">
							LLM Gateway · Airside
						</div>
						<div className="font-display text-xl leading-tight font-black tracking-tight uppercase sm:text-2xl">
							Airworthy certificate
						</div>
					</div>
					<div className="text-right font-mono text-[0.6rem] leading-relaxed tracking-widest uppercase">
						<div className="opacity-70">Standard</div>
						<div className="text-sm font-bold">AW-1</div>
					</div>
				</div>
				<dl className="relative mt-3 grid grid-cols-2 border-t border-l border-[var(--ink)]/40">
					{FIELDS.map((field) => (
						<div
							key={field.box}
							className={cn(
								"border-r border-b border-[var(--ink)]/40 px-2 py-1.5",
								field.wide && "col-span-2",
							)}
						>
							<dt className="font-mono text-[0.55rem] tracking-widest uppercase opacity-70">
								{field.box}. {field.label}
							</dt>
							<dd className="font-mono text-xs font-semibold tracking-wide sm:text-[0.8rem]">
								{field.value}
							</dd>
						</div>
					))}
				</dl>
				<div className="relative mt-3 flex items-end justify-between gap-4 font-mono text-[0.6rem] tracking-widest uppercase">
					<div>
						<div className="opacity-70">10. Certificate no.</div>
						<div className="text-xs font-bold">AW1-2026-7K4Q9D</div>
						<div className="mt-1.5 opacity-70">11. Valid until</div>
						<div className="text-xs font-bold">12 months from issue</div>
					</div>
				</div>
				<div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] font-display text-6xl font-black tracking-widest text-[var(--ink)]/[0.05] uppercase">
					Specimen
				</div>
				<AirworthyStamp
					certificateNumber="AW1-2026-7K4Q9D"
					className="animate-stamp-press absolute -right-6 -bottom-10 h-36 w-36 text-[var(--stamp)] sm:-right-10 sm:h-44 sm:w-44"
					aria-hidden="true"
				/>
			</div>
		</figure>
	);
}
