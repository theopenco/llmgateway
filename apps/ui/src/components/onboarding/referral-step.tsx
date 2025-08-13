"use client";

import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";

interface ReferralStepProps {
	onComplete?: (source: string, details?: string) => void;
}

export function ReferralStep({ onComplete }: ReferralStepProps) {
	const [selectedSource, setSelectedSource] = useState<string>("");
	const [otherDetails, setOtherDetails] = useState<string>("");

	const referralSources = [
		{ value: "twitter", label: "X (Formerly Twitter)" },
		{ value: "reddit", label: "Reddit" },
		{ value: "producthunt", label: "ProductHunt" },
		{ value: "devntell", label: "DevNTell podcast" },
		{ value: "other", label: "Other (Specify)" },
	];

	const handleContinue = () => {
		if (selectedSource) {
			const details = selectedSource === "other" ? otherDetails : undefined;
			onComplete?.(selectedSource, details);
		}
	};

	const handleSkip = () => {
		onComplete?.("");
	};

	return (
		<div className="space-y-6">
			<div className="text-center space-y-2">
				<h2 className="text-2xl font-semibold tracking-tight">
					How did you hear about us?
				</h2>
				<p className="text-muted-foreground">
					Help us understand how people discover LLM Gateway (Optional)
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Referral Source</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<RadioGroup
						value={selectedSource}
						onValueChange={setSelectedSource}
						className="space-y-3"
					>
						{referralSources.map((source) => (
							<div key={source.value} className="flex items-center space-x-2">
								<RadioGroupItem value={source.value} id={source.value} />
								<Label
									htmlFor={source.value}
									className="flex-1 cursor-pointer text-sm font-normal"
								>
									{source.label}
								</Label>
							</div>
						))}
					</RadioGroup>

					{selectedSource === "other" && (
						<div className="mt-4 space-y-2">
							<Label htmlFor="other-details" className="text-sm font-medium">
								Please specify:
							</Label>
							<Input
								id="other-details"
								placeholder="Where did you hear about us?"
								value={otherDetails}
								onChange={(e) => setOtherDetails(e.target.value)}
								className="w-full"
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<div className="flex gap-3 pt-4">
				<Button variant="outline" onClick={handleSkip} className="flex-1">
					Skip
				</Button>
				<Button
					onClick={handleContinue}
					disabled={
						!selectedSource ||
						(selectedSource === "other" && !otherDetails.trim())
					}
					className="flex-1"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
