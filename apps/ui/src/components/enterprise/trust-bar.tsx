export function TrustBarEnterprise() {
	const companies = [
		"Acme Corp",
		"TechStart",
		"DataFlow",
		"CloudScale",
		"SecureAI",
	];

	return (
		<section className="border-y border-border bg-muted/30 py-12">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<p className="mb-8 text-center text-sm text-muted-foreground uppercase tracking-wider">
					Trusted by enterprise teams worldwide
				</p>
				<div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
					{companies.map((company) => (
						<div
							key={company}
							className="text-xl font-semibold text-muted-foreground/60"
						>
							{company}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
