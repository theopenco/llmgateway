"use client";

/**
 * The compliance page is no longer gated behind a full-page upsell: the
 * data-protection controls (GDPR, prompt training, prompt logging, stealth
 * providers, provider headquarters) are available on every plan, because they
 * are how a customer constrains where their personal data is transferred and
 * they are the controller for it. Only the certification requirements and the
 * per-provider/per-model allow and block lists are Enterprise, so what is left
 * here is an inline link rather than a card that hides the whole page.
 */
export function ContactSalesLink() {
	return (
		<a
			href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Compliance"
			className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
		>
			Contact sales
		</a>
	);
}
