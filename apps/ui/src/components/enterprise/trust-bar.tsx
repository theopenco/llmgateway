const companies = [
	{
		name: "Samsung",
		className: "text-2xl font-bold tracking-wider uppercase",
	},
	{
		name: "Harvard",
		className: "text-2xl font-bold tracking-tight",
	},
	{
		name: "Coloop.ai",
		className: "text-2xl font-semibold tracking-tight",
	},
	{
		name: "FieldKo",
		className: "text-2xl font-bold tracking-tight",
	},
];

export function TrustBarEnterprise() {
	return (
		<section className="border-y border-border bg-muted/30 py-12">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<p className="mb-8 text-center text-sm text-muted-foreground uppercase tracking-wider">
					Trusted by innovative teams worldwide
				</p>
				<div className="flex flex-wrap items-center justify-center gap-10 sm:gap-14">
					{companies.map((company) => (
						<div
							key={company.name}
							className={`text-muted-foreground/50 select-none ${company.className}`}
						>
							{company.name}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
