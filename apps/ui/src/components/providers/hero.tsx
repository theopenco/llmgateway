import {
	providers as providerDefinitions,
	type ProviderId,
} from "@llmgateway/models";

import { AuthLink } from "../shared/auth-link";
import { providerLogoUrls } from "@/components/provider-keys/provider-logo";
import { Button } from "@/lib/components/button";
import Logo from "@/lib/icons/Logo";

interface HeroProps {
	providerId: ProviderId;
}

export function Hero({ providerId }: HeroProps) {
	const provider = providerDefinitions.find((p) => p.id === providerId)!;

	const getProviderIcon = (providerId: ProviderId) => {
		const LogoComponent = providerLogoUrls[providerId];
		if (LogoComponent) {
			return <LogoComponent className="h-24 w-24 object-contain" />;
		}

		return <Logo className="h-24 w-24" />;
	};

	return (
		<div className="relative isolate overflow-hidden bg-background">
			<div className="mx-auto container px-6 pb-24 pt-10 sm:pb-32 lg:grid lg:grid-cols-2 lg:gap-x-8 lg:px-0 lg:py-40">
				<div className="mx-auto max-w-2xl lg:mx-0 lg:max-w-xl lg:pt-8">
					{provider.announcement !== null && (
						<div className="mt-24 sm:mt-32 lg:mt-16">
							<div className="inline-flex space-x-6">
								<span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold leading-6 text-primary ring-1 ring-inset ring-primary/10">
									{provider.announcement}
								</span>
							</div>
						</div>
					)}
					<h1 className="mt-10 text-4xl font-bold tracking-tight sm:text-6xl">
						{provider.name} Provider
					</h1>
					<p className="mt-6 text-lg leading-8 text-muted-foreground">
						{provider.description}
					</p>
					<div className="mt-10 flex items-center gap-x-6">
						<Button asChild>
							<AuthLink href="/signup">Get started</AuthLink>
						</Button>
						<Button variant="outline" asChild>
							<a
								href={`${provider.website}?utm_source=llmgateway-models`}
								target="_blank"
							>
								Visit company
							</a>
						</Button>
					</div>
				</div>
				<div className="flex items-center justify-center gap-8 relative">
					<div className="h-24 w-24 relative -top-12">
						<Logo className="h-full w-full" />
					</div>
					<div className="flex items-center h-32">
						<div className="w-0.5 h-52 bg-muted-foreground opacity-50 rounded rotate-[30deg]" />
					</div>
					<div className="h-24 w-24 relative top-10">
						{getProviderIcon(providerId)}
					</div>
				</div>
			</div>
		</div>
	);
}
