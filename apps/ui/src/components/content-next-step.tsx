import { BlogCta } from "@/components/blog/blog-cta";
import { NewModelsSignup } from "@/components/timeline/new-models-signup";

/**
 * Closes a content page with a next step for both kinds of reader: the offer
 * that fits the page for the one ready to try it, and an email signup for the
 * one who is not.
 */
export function ContentNextStep({
	surface,
	variant,
	showOffer = true,
}: {
	/** Content type, for analytics: "blog", "guide". */
	surface: string;
	variant: "devpass" | "gateway";
	/** False when the content already ends on its own offer card. */
	showOffer?: boolean;
}) {
	return (
		<section aria-label="Next steps" className="not-prose mt-12">
			{showOffer ? (
				<BlogCta variant={variant} surface={surface} location="end" />
			) : null}
			<div
				data-inline-cta
				className="rounded-xl border bg-muted/30 px-6 py-8 text-center"
			>
				<h2 className="text-lg font-semibold tracking-tight text-foreground">
					Not ready to switch yet?
				</h2>
				<p className="mx-auto mt-1 mb-4 max-w-md text-sm text-muted-foreground">
					Follow new model releases instead.
				</p>
				<NewModelsSignup placement={`${surface}_end`} />
			</div>
		</section>
	);
}
