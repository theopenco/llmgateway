import Script from "next/script";

interface GoogleTagProps {
	googleTagId?: string;
	googleAdsSignupConversion?: string;
	googleAdsPurchaseConversion?: string;
}

export function GoogleTag({
	googleTagId,
	googleAdsSignupConversion,
	googleAdsPurchaseConversion,
}: GoogleTagProps) {
	const signupAdsTagId = googleAdsSignupConversion?.split("/")[0];
	const purchaseAdsTagId = googleAdsPurchaseConversion?.split("/")[0];
	const tagIds = [googleTagId, signupAdsTagId, purchaseAdsTagId].filter(
		(id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index,
	);

	if (!tagIds.length) {
		return null;
	}

	return (
		<>
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${tagIds[0]}`}
				strategy="afterInteractive"
			/>
			<Script id="google-tag-init" strategy="afterInteractive">
				{`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
${tagIds.map((id) => `gtag('config', '${id}');`).join("\n")}`}
			</Script>
		</>
	);
}
