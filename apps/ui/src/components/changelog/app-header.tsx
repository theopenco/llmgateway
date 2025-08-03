import Link from "next/link";

import { Button } from "@/lib/components/button";
import Logo from "@/lib/icons/Logo";

export const AppHeader = () => (
	<header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
			<div className="flex items-center justify-between h-16">
				<div className="flex items-center space-x-8">
					<Link
						href="/"
						className="flex items-center space-x-2 text-lg font-semibold text-foreground"
						prefetch={true}
					>
						<Logo className="h-6 w-6" />
						<span>LLM Gateway</span>
					</Link>
					<nav className="hidden md:flex items-center space-x-6 text-sm font-medium text-muted-foreground">
						<Link
							href="/models"
							className="hover:text-foreground transition-colors"
							prefetch={true}
						>
							Models
						</Link>
						<Link
							href="/playground"
							className="hover:text-foreground transition-colors"
							prefetch={true}
						>
							Playground
						</Link>
						<Link
							href="/changelog"
							className="hover:text-foreground transition-colors"
							prefetch={true}
						>
							Changelog
						</Link>
					</nav>
				</div>
				<div className="flex items-center space-x-4">
					<Link
						href="/login"
						className="hidden sm:inline-block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
						prefetch={true}
					>
						Log in
					</Link>
					<Button
						asChild
						variant="secondary"
						className="rounded-md text-sm font-medium"
					>
						<Link href="/signup" prefetch={true}>
							Sign up
						</Link>
					</Button>
				</div>
			</div>
		</div>
	</header>
);
