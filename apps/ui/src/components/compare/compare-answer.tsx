import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";

export interface CompareAnswerRow {
	label: string;
	llmGateway: string;
	competitor: string;
}

interface CompareAnswerProps {
	competitor: string;
	verdict: string;
	rows: CompareAnswerRow[];
}

/** The short answer that opens a comparison page: a verdict and a summary table. */
export function CompareAnswer({
	competitor,
	verdict,
	rows,
}: CompareAnswerProps) {
	return (
		<section
			aria-labelledby="compare-answer-heading"
			className="container mx-auto max-w-4xl px-4 py-12 md:px-6"
		>
			<h2
				id="compare-answer-heading"
				className="text-2xl font-bold tracking-tight md:text-3xl"
			>
				LLM Gateway vs {competitor}: the short answer
			</h2>
			<p className="mt-4 text-lg leading-relaxed text-muted-foreground">
				{verdict}
			</p>
			<div className="mt-6 overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead scope="col" className="min-w-32" />
							<TableHead scope="col">LLM Gateway</TableHead>
							<TableHead scope="col">{competitor}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.label}>
								<TableHead scope="row" className="font-medium">
									{row.label}
								</TableHead>
								<TableCell className="whitespace-normal">
									{row.llmGateway}
								</TableCell>
								<TableCell className="whitespace-normal">
									{row.competitor}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<p className="mt-3 text-sm text-muted-foreground">
				Competitor details come from each vendor&apos;s public documentation,
				listed in the sources below.
			</p>
		</section>
	);
}
