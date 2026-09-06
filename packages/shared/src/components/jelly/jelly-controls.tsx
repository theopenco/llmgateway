import { useId } from "react";

import { jellyFlavors } from "./jelly-settings";

import type { JellySettings } from "./jelly-settings";

interface JellyControlsProps {
	value: JellySettings;
	disabled: boolean;
	reduced: boolean;
	onChange: (value: JellySettings) => void;
	onNudge: () => void;
	onReset: () => void;
}

export function JellyControls({
	value,
	disabled,
	reduced,
	onChange,
	onNudge,
	onReset,
}: JellyControlsProps) {
	const id = useId();
	const buttonClass =
		"min-h-11 whitespace-nowrap rounded-xl border border-border px-2 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40";
	return (
		<fieldset
			disabled={disabled}
			aria-label="Jelly controls"
			className="w-full space-y-5 rounded-3xl border border-border/70 bg-background/85 p-5 text-left shadow-sm backdrop-blur-xl lg:w-[260px]"
		>
			<div className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
				The specimen
			</div>
			<div className="flex gap-1" aria-label="Jelly color">
				{(Object.keys(jellyFlavors) as (keyof typeof jellyFlavors)[]).map(
					(flavor) => (
						<button
							key={flavor}
							type="button"
							aria-pressed={value.flavor === flavor}
							onClick={() => onChange({ ...value, flavor })}
							className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-full border px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${value.flavor === flavor ? "border-foreground/50 bg-background" : "border-transparent bg-muted/50 hover:bg-muted"}`}
						>
							<span
								className="size-2 rounded-full"
								style={{ backgroundColor: jellyFlavors[flavor].swatch }}
							/>
							{jellyFlavors[flavor].label}
						</button>
					),
				)}
			</div>
			<div className="space-y-2">
				<label
					htmlFor={`${id}-firmness`}
					className="flex justify-between text-xs"
				>
					Firmness{" "}
					<output className="font-mono text-muted-foreground">
						{value.firmness.toFixed(1)} kPa
					</output>
				</label>
				<input
					id={`${id}-firmness`}
					type="range"
					min="0.4"
					max="4"
					step="0.1"
					value={value.firmness}
					onChange={(event) =>
						onChange({ ...value, firmness: Number(event.target.value) })
					}
					className="h-6 w-full cursor-pointer accent-foreground"
				/>
			</div>
			<div className="space-y-2">
				<label
					htmlFor={`${id}-damping`}
					className="flex justify-between text-xs"
				>
					Internal damping{" "}
					<output className="font-mono text-muted-foreground">
						{value.damping.toFixed(1)} s⁻¹
					</output>
				</label>
				<input
					id={`${id}-damping`}
					type="range"
					min="0.5"
					max="10"
					step="0.5"
					value={value.damping}
					onChange={(event) =>
						onChange({ ...value, damping: Number(event.target.value) })
					}
					className="h-6 w-full cursor-pointer accent-foreground"
				/>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<button
					type="button"
					disabled={reduced || value.paused}
					onClick={onNudge}
					className={`${buttonClass} border-foreground bg-foreground text-background hover:bg-foreground/90`}
				>
					Give it a nudge
				</button>
				<button type="button" onClick={onReset} className={buttonClass}>
					Reset
				</button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
				<label className="flex min-h-8 items-center gap-1.5">
					<input
						type="checkbox"
						checked={value.slow}
						disabled={reduced}
						onChange={(event) =>
							onChange({ ...value, slow: event.target.checked })
						}
						className="accent-foreground"
					/>
					¼ speed
				</label>
				<label className="flex min-h-8 items-center gap-1.5">
					<input
						type="checkbox"
						checked={value.wireframe}
						onChange={(event) =>
							onChange({ ...value, wireframe: event.target.checked })
						}
						className="accent-foreground"
					/>
					Show mesh
				</label>
				<button
					type="button"
					disabled={reduced}
					aria-pressed={value.paused}
					onClick={() => onChange({ ...value, paused: !value.paused })}
					className="min-h-8 rounded-full border border-border px-2.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				>
					{value.paused ? "Resume" : "Pause"}
				</button>
			</div>
		</fieldset>
	);
}
