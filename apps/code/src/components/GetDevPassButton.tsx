"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CodeCTATracker } from "@/components/LandingTracker";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";

export function GetDevPassButton({
	signupHref = "/signup",
	cta,
	location,
	showArrow = false,
	className,
}: {
	signupHref?: string;
	cta: string;
	location: string;
	showArrow?: boolean;
	className?: string;
}) {
	const { user, isLoading } = useUser();
	const isAuthenticated = !!user && !isLoading;

	return (
		<CodeCTATracker cta={cta} location={location}>
			<Button size="lg" className={className} asChild>
				<Link href={isAuthenticated ? "/dashboard" : signupHref}>
					{isAuthenticated ? "Go to Dashboard" : "Get your DevPass"}
					{showArrow && <ArrowRight className="h-4 w-4" />}
				</Link>
			</Button>
		</CodeCTATracker>
	);
}
