import {
	ExternalLink,
	Play,
	ShieldCheck,
	ShieldAlert,
	MapPin,
	Database,
	Eye,
	Clock,
} from "lucide-react";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { getConfig } from "@/lib/config-server";
import Logo from "@/lib/icons/Logo";

import {
	providers as providerDefinitions,
	type ProviderId,
} from "@llmgateway/models";
import { providerLogoUrls } from "@llmgateway/shared/components";

interface HeroProps {
	providerId: ProviderId;
}

function DataPolicyBadge({
	value,
	labelTrue,
	labelFalse,
	dangerIfTrue = false,
}: {
	value: boolean | null;
	labelTrue: string;
	labelFalse: string;
	dangerIfTrue?: boolean;
}) {
	if (value === null) {
		return (
			<span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
				Unknown
			</span>
		);
	}

	const isDanger = dangerIfTrue ? value : !value;

	if (isDanger) {
		return (
			<span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
				{value ? labelTrue : labelFalse}
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-xs text-green-600 dark:text-green-400">
			{value ? labelTrue : labelFalse}
		</span>
	);
}

export function Hero({ providerId }: HeroProps) {
	const config = getConfig();
	const provider = providerDefinitions.find((p) => p.id === providerId)!;
	const referenceLinks = [
		provider.statusPageUrl
			? { label: "Status Page", href: provider.statusPageUrl }
			: null,
		provider.termsUrl
			? { label: "Terms of Service", href: provider.termsUrl }
			: null,
		provider.privacyPolicyUrl
			? { label: "Privacy Policy", href: provider.privacyPolicyUrl }
			: null,
	].filter((link): link is { label: string; href: string } => link !== null);

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
								href={config.playgroundUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								<Play className="h-4 w-4" />
								Try in Playground
							</a>
						</Button>
						<Button variant="ghost" asChild>
							<a
								href={`${provider.website}?utm_source=llmgateway-models`}
								target="_blank"
							>
								Visit company
							</a>
						</Button>
					</div>

					{(provider.dataPolicy || provider.headquarters) && (
						<div className="mt-8 rounded-lg border bg-card p-4">
							<h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
								{provider.dataPolicy?.apiTraining === false ? (
									<ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
								) : (
									<ShieldAlert className="h-4 w-4 text-muted-foreground" />
								)}
								Data & Privacy
							</h3>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
								{provider.headquarters && (
									<div className="flex items-center gap-2">
										<MapPin className="h-3.5 w-3.5 text-muted-foreground" />
										<span className="text-muted-foreground">HQ:</span>
										<span className="font-medium">{provider.headquarters}</span>
									</div>
								)}
								{provider.dataPolicy && (
									<>
										<div className="flex items-center gap-2">
											<Database className="h-3.5 w-3.5 text-muted-foreground" />
											<span className="text-muted-foreground">
												API Training:
											</span>
											<DataPolicyBadge
												value={provider.dataPolicy.apiTraining}
												labelTrue="Yes"
												labelFalse="No"
												dangerIfTrue
											/>
										</div>
										<div className="flex items-center gap-2">
											<Database className="h-3.5 w-3.5 text-muted-foreground" />
											<span className="text-muted-foreground">
												Consumer Training:
											</span>
											<DataPolicyBadge
												value={provider.dataPolicy.consumerTraining}
												labelTrue="Yes"
												labelFalse="No"
												dangerIfTrue
											/>
										</div>
										<div className="flex items-center gap-2">
											<Eye className="h-3.5 w-3.5 text-muted-foreground" />
											<span className="text-muted-foreground">
												Prompt Logging:
											</span>
											<DataPolicyBadge
												value={provider.dataPolicy.promptLogging}
												labelTrue="Yes"
												labelFalse="No"
												dangerIfTrue
											/>
										</div>
										{provider.dataPolicy.retentionPeriod !== undefined && (
											<div className="flex items-center gap-2">
												<Clock className="h-3.5 w-3.5 text-muted-foreground" />
												<span className="text-muted-foreground">
													Retention:
												</span>
												<span className="font-medium">
													{provider.dataPolicy.retentionPeriod ?? "Unknown"}
												</span>
											</div>
										)}
										{provider.dataPolicy.gdpr !== undefined && (
											<div className="flex items-center gap-2">
												<ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
												<span className="text-muted-foreground">GDPR:</span>
												<DataPolicyBadge
													value={provider.dataPolicy.gdpr}
													labelTrue="Compliant"
													labelFalse="No"
												/>
											</div>
										)}
										{provider.dataPolicy.soc2 !== undefined && (
											<div className="flex items-center gap-2">
												<ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
												<span className="text-muted-foreground">SOC2:</span>
												<DataPolicyBadge
													value={provider.dataPolicy.soc2}
													labelTrue="Certified"
													labelFalse="No"
												/>
											</div>
										)}
										{provider.dataPolicy.iso27001 !== undefined && (
											<div className="flex items-center gap-2">
												<ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
												<span className="text-muted-foreground">
													ISO 27001:
												</span>
												<DataPolicyBadge
													value={provider.dataPolicy.iso27001}
													labelTrue="Certified"
													labelFalse="No"
												/>
											</div>
										)}
									</>
								)}
							</div>
							{provider.additionalLinks &&
								provider.additionalLinks.length > 0 && (
									<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm text-muted-foreground">
										{provider.additionalLinks.map((additionalLink) => (
											<a
												key={additionalLink.link}
												href={additionalLink.link}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
											>
												{additionalLink.desc}
												<ExternalLink className="h-3 w-3" />
											</a>
										))}
									</div>
								)}
						</div>
					)}

					{referenceLinks.length > 0 && (
						<div className="mt-4 flex items-center gap-x-4 text-sm text-muted-foreground">
							{referenceLinks.map((link, index) => (
								<div key={link.href} className="flex items-center gap-x-4">
									{index > 0 && (
										<span className="text-muted-foreground/50">|</span>
									)}
									<a
										href={link.href}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
									>
										{link.label}
										<ExternalLink className="h-3 w-3" />
									</a>
								</div>
							))}
						</div>
					)}
				</div>
				<div className="flex items-center justify-center gap-8 relative mt-20 lg:mt-0">
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
