import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Progress } from "./progress";

export interface StepperProps {
	steps: {
		id: string;
		title: string;
		description?: string;
		optional?: boolean;
		customNextText?: string;
	}[];
	activeStep: number;
	onStepChange: (step: number) => void;
	className?: string;
	children?: React.ReactNode;
	nextButtonDisabled?: boolean;
}

export function Stepper({
	steps,
	activeStep,
	onStepChange,
	className,
	children,
	nextButtonDisabled,
}: StepperProps) {
	const progress = Math.round(((activeStep + 1) / steps.length) * 100);
	const currentStep = steps[activeStep];

	return (
		<div className={cn("flex flex-col gap-8", className)}>
			<div className="flex flex-col gap-4">
				{/* Desktop stepper - show full horizontal layout */}
				<div className="hidden md:flex flex-col gap-4">
					<Progress value={progress} className="h-2" />
					<div className="flex justify-between">
						{steps.map((step, index) => {
							const isActive = activeStep === index;
							const isCompleted = activeStep > index;
							const isClickable = isCompleted || index === activeStep + 1;

							return (
								<div
									key={step.id}
									className={cn(
										"flex flex-col items-center gap-2",
										isActive && "text-primary",
										isCompleted && "text-primary",
										!isActive && !isCompleted && "text-muted-foreground",
									)}
								>
									<button
										type="button"
										onClick={() => isClickable && onStepChange(index)}
										className={cn(
											"flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium",
											isActive &&
												"border-primary bg-primary text-primary-foreground",
											isCompleted &&
												"border-primary bg-primary text-primary-foreground",
											!isActive && !isCompleted && "border-muted-foreground",
											isClickable
												? "cursor-pointer"
												: "cursor-not-allowed opacity-50",
										)}
										disabled={!isClickable}
									>
										{isCompleted ? <Check className="h-4 w-4" /> : index + 1}
									</button>
									<span className="text-xs font-medium text-center">
										{step.title}
									</span>
									{step.optional && (
										<span className="text-xs text-muted-foreground text-center">
											(Optional)
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Mobile stepper - compact circular progress with current/next step */}
				<div className="md:hidden flex items-center gap-4">
					<div className="relative flex h-14 w-14 items-center justify-center">
						<svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
							<path
								className="text-muted-foreground/20"
								d="M18 2.0845
									a 15.9155 15.9155 0 0 1 0 31.831
									a 15.9155 15.9155 0 0 1 0 -31.831"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							/>
							<path
								className="text-primary"
								d="M18 2.0845
									a 15.9155 15.9155 0 0 1 0 31.831
									a 15.9155 15.9155 0 0 1 0 -31.831"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeDasharray={`${progress}, 100`}
							/>
						</svg>
						<span className="absolute text-xs font-medium">
							{activeStep + 1} of {steps.length}
						</span>
					</div>
					<div className="flex flex-col gap-1">
						<h3 className="font-medium text-sm">
							{currentStep?.title}
							{currentStep?.optional && (
								<span className="text-muted-foreground ml-1">(Optional)</span>
							)}
						</h3>
						{activeStep < steps.length - 1 && (
							<p className="text-xs text-muted-foreground">
								Next: {steps[activeStep + 1]?.title}
							</p>
						)}
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-6">{children}</div>

			<div className="flex justify-between">
				<Button
					variant="outline"
					onClick={() => onStepChange(activeStep - 1)}
					disabled={activeStep === 0}
				>
					Back
				</Button>
				<div className="flex gap-2">
					{steps[activeStep]?.optional && (
						<Button
							variant="ghost"
							onClick={() => onStepChange(activeStep + 1)}
						>
							Skip
						</Button>
					)}
					<Button
						onClick={() => onStepChange(activeStep + 1)}
						disabled={nextButtonDisabled ?? activeStep === steps.length - 1}
					>
						{currentStep?.customNextText ??
							(activeStep === steps.length - 1 ? "Finish" : "Next")}
					</Button>
				</div>
			</div>
		</div>
	);
}

export interface StepProps {
	children: React.ReactNode;
	className?: string;
}

export function Step({ children, className }: StepProps) {
	return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}
