import Link from "next/link";

export function DevPassPlanChangeNotice() {
	return (
		<section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm leading-relaxed text-foreground">
			<h2 className="font-semibold">Plan changes from October 15, 2026</h2>
			<p className="mt-2">
				Same subscription price, less included usage. Monthly allowance falls
				from 3&times; to 2&times; your plan price at your first renewal on or
				after that date. New subscriptions from that date start at 2&times;.
			</p>
			<p className="mt-2">
				Daily caps, tighter premium weekly caps, and updated Reset Pass benefits
				apply on October 15, including during existing billing cycles. Review
				the&nbsp;
				<Link
					href="/legal/terms#october-2026-plan-changes"
					className="font-medium underline underline-offset-4"
				>
					full changes before subscribing
				</Link>
				.
			</p>
		</section>
	);
}
