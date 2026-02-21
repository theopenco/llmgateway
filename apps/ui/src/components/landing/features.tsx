import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { GlowingEffect } from "./glowing-effect";

import type { ReactNode } from "react";

interface FeatureItem {
	icon: ReactNode;
	title: string;
	description: string;
	slug: string;
}

const features: FeatureItem[] = [
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 148 139"
			>
				<path
					d="M0 37C0 16.5655 16.5655 0 37 0h73.217c20.434 0 37 16.5655 37 37v65c0 20.435-16.566 37-37 37H37c-20.4345 0-37-16.565-37-37V37Z"
					fill="#626264"
				/>
				<path
					d="M69.5 73.266h8.9015c-.913 6.1626.4793 18.1453 13.3522 16.7758v18.1452c.1141 1.484 1.3695 4.656 5.4778 5.478h22.5965c1.711-.685 5.204-2.739 5.477-5.478V87.3029c-.228-2.1683-1.643-6.5049-5.477-6.5049H91.7537c-1.4836-.2282-3.766-2.3965-3.766-6.5049v-9.5862c0-4.1084 2.2824-6.2767 3.766-6.5049h28.0743c3.834 0 5.249-4.3367 5.477-6.505V30.8128c-.273-2.7389-3.766-4.7931-5.477-5.4778H97.2315c-4.1083.8216-5.3637 3.9942-5.4778 5.4778v18.1453C78.8808 47.5887 77.4885 59.5714 78.4015 65.734H69.5c.913-6.1626-.4793-18.1453-13.3522-16.7759V30.8128c-.1141-1.4836-1.3695-4.6562-5.4778-5.4778H28.0739c-1.7118.6847-5.2039 2.7389-5.4778 5.4778V51.697c.2282 2.1683 1.6433 6.505 5.4778 6.505h28.0739c1.4836.2282 3.766 2.3965 3.766 6.5049v9.5862c0 4.1084-2.2824 6.2767-3.766 6.5049H28.0739c-3.8345 0-5.2496 4.3366-5.4778 6.5049v20.8841c.2739 2.739 3.766 4.793 5.4778 5.478H50.67c4.1083-.822 5.3637-3.994 5.4778-5.478V90.0418C69.0207 91.4113 70.413 79.4286 69.5 73.266Z"
					fill="#D0D0C6"
				/>
				<path
					d="M32.1823 36.5517c0-1.6568 1.3431-3 3-3h8.3793c1.6568 0 3 1.3432 3 3v8.3793c0 1.6569-1.3432 3-3 3h-8.3793c-1.6569 0-3-1.3431-3-3v-8.3793ZM32.1823 93.3842c0-1.6568 1.3431-3 3-3h8.3793c1.6568 0 3 1.3432 3 3v8.3798c0 1.656-1.3432 3-3 3h-8.3793c-1.6569 0-3-1.344-3-3v-8.3798ZM101.34 36.5517c0-1.6568 1.343-3 3-3h8.379c1.657 0 3 1.3432 3 3v8.3793c0 1.6569-1.343 3-3 3h-8.379c-1.657 0-3-1.3431-3-3v-8.3793ZM101.34 93.3842c0-1.6568 1.343-3 3-3h8.379c1.657 0 3 1.3432 3 3v8.3798c0 1.656-1.343 3-3 3h-8.379c-1.657 0-3-1.344-3-3v-8.3798Z"
					fill="#4D4D4B"
				/>
			</svg>
		),
		title: "Unified API Interface",
		description:
			"Keep your existing OpenAI SDK code—just change the base URL and you're live.",
		slug: "unified-api-interface",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 161 162"
			>
				<path
					d="M23.0177 83.7271c1.2867.7188 2.4615.7548 3.7173.1867 2.8495-1.2891 3.7334-4.781 4.0121-7.8961 1.8361-20.5263 15.1133-28.817 21.9943-30.4143v4.0142c0 1.0129.1453 2.0784.823 2.8313 1.9947 2.2161 4.935.2011 6.3149-1.2938l9.9138-9.5172c2.5987-2.4255 2.0358-5.1903.8612-6.7116-.4863-.6297-1.1446-1.1063-1.7072-1.6689l-9.0678-9.0678c-2.6759-2.6759-4.901-1.6366-6.2104-.172-.7243.8102-.9275 1.9274-.9275 3.0141v5.4855c-24.4947 7.6902-31.8565 30.4463-32.8183 44.1047-.1946 2.7635.6759 5.7542 3.0946 7.1052Z"
					fill="#48474F"
				/>
				<circle cx="107.069" cy="31.7241" r="31.7241" fill="#E9A92E" />
				<circle cx="131.259" cy="125.707" r="29.7414" fill="#CC595E" />
				<circle cx="34.8966" cy="125.31" r="34.8966" fill="#5891D1" />
				<path
					d="M137.617 94.0779c7.388-3.5978 3.803-18.7268.621-27.183-.393-1.046-1.058-1.9757-1.945-2.6551-2.966-2.2705-5.081-2.8945-7.216-1.9595-2.68 1.1738-2.826 4.7445-1.856 7.5047 2.248 6.3907 2.652 12.7538 2.52 15.5761-.719 8.8109 5.766 9.6595 7.876 8.7168ZM97.1552 140.379c4.7588-1.586 5.9478 3.834 5.9478 6.742s-1.189 8.327-5.9478 6.741v5.552c-1.3219 1.454-4.6793 3.727-7.5345 1.189l-13.7363-11.975c-.9143-.797-.9143-2.218 0-3.015l13.7363-11.975c2.8552-2.538 6.2126-.264 7.5345 1.19v5.551Z"
					fill="#48474F"
				/>
			</svg>
		),
		title: "Multi-provider Support",
		description:
			"Access 60+ providers through one integration—no vendor lock-in, switch models instantly.",
		slug: "multi-provider-support",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 161 161"
			>
				<circle cx="80.5" cy="80.5" r="61.457" fill="#C9C4BE" />
				<path
					d="M79.3967 16.4772c9.7693-.0828 19.4297 2.1253 28.2543 6.459 8.824 4.3337 16.583 10.6798 22.691 18.5606 6.108 7.8807 10.407 17.0911 12.574 26.9375 1.548 7.0349 1.979 14.2639 1.293 21.4059-.453 4.7166-5.128 7.5983-9.736 6.4926-4.511-1.0825-7.243-5.5932-6.986-10.225.053-.9481.08-1.9033.08-2.865 0-27.1944-21.33-49.2402-47.641-49.2402-26.3109.0001-47.6397 22.0459-47.6397 49.2402 0 1.2363.0443 2.4618.1311 3.6751.331 4.6252-2.3245 9.1778-6.8146 10.3361-4.5924 1.1846-9.3198-1.6229-9.8475-6.3362-.7977-7.1257-.4816-14.3569.9539-21.4132 2.0102-9.8817 6.1631-19.1633 12.1455-27.1465 5.9825-7.9833 13.6392-14.4605 22.3935-18.9434 8.7544-4.4828 18.379-6.8546 28.1485-6.9375Z"
					fill="url(#a)"
				/>
				<path
					d="M80.5 0C124.959 0 161 36.0411 161 80.5c0 44.459-36.041 80.5-80.5 80.5C36.0411 161 0 124.959 0 80.5 0 36.0411 36.0411 0 80.5 0Zm0 19.043c-33.9418 0-61.457 27.5152-61.457 61.457 0 33.942 27.5153 61.457 61.457 61.457 33.942 0 61.457-27.515 61.457-61.457 0-33.9417-27.515-61.457-61.457-61.457Z"
					fill="#626264"
				/>
				<circle cx="80.5001" cy="80.5" r="9.08871" fill="#000" />
				<path
					d="M78.7973 81.3148c-2.1067-2.6761-1.46-6.5836 1.3966-8.4383l31.5091-20.4577c1.114-.7236 2.597-.4783 3.419.5658.828 1.0527.709 2.5654-.274 3.4756l-27.5671 25.522c-2.4805 2.2965-6.3926 1.9888-8.4836-.6674Z"
					fill="#000"
				/>
				<defs>
					<linearGradient
						id="a"
						x1="23.0599"
						y1="63.7339"
						x2="137.463"
						y2="63.7339"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#E25137" />
						<stop offset=".134763" stopColor="#E96131" />
						<stop offset=".293302" stopColor="#E29231" />
						<stop offset=".441502" stopColor="#E2A635" />
						<stop offset=".569022" stopColor="#D0AC3E" />
						<stop offset=".699989" stopColor="#8CBF3F" />
						<stop offset=".834403" stopColor="#2E9E4E" />
						<stop offset="1" stopColor="#178977" />
					</linearGradient>
				</defs>
			</svg>
		),
		title: "Performance Monitoring",
		description:
			"Compare latency, cost, and quality across models to pick the best fit for each use case.",
		slug: "performance-monitoring",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 129 152"
			>
				<path
					d="M118.381 21.1753 70.5943 1.62615c-4.9904-2.013897-7.8284-2.317207-13.0328 0L9.77459 21.1753l-.0891.0474C5.82278 23.2738 0 26.3657 0 42.1726v36.2022c0 20.6417 18.8226 60.8432 60.4576 72.3802 1.4143.392 2.9281.392 4.3427.001 41.7327-11.535 63.3557-51.7388 63.3557-72.3812V42.1726c0-15.8069-5.823-18.8988-9.686-20.9499l-.089-.0474Z"
					fill="#616163"
				/>
				<path
					d="m66.2822 65.1639 7.0841 7.394 7.0841 7.3939-47.633 45.6372c-5.0184 4.808-13.018 8.254-18.2735 3.706-.5899-.51-1.1093-1.085-1.5611-1.739-3.43011-4.963.1412-11.461 4.4979-15.635l48.8015-46.7571Z"
					fill="#E6B747"
				/>
				<path
					d="M52.2287 132.374c-.4652 1.972-1.3275 3.355-2.8848 4.234-4.1117 2.323-9.0459-.669-12.3609-4.032l-6.1944-6.284 25.6352-23.841 5.713 5.796c3.5601 3.611 6.7166 9.897 2.7433 13.048-.3041.241-.6408.449-1.0152.626-3.0352 1.428-6.4373-.596-8.7922-2.985l-5.6571 5.421c2.1087 2.139 3.5026 5.093 2.8131 8.017Z"
					fill="#E6B747"
				/>
				<ellipse
					cx="90.8676"
					cy="57.9235"
					rx="30.0478"
					ry="28.9618"
					fill="#E6B747"
				/>
				<ellipse
					cx="91.2293"
					cy="57.5615"
					rx="10.8607"
					ry="11.2227"
					fill="#616163"
				/>
			</svg>
		),
		title: "Secure Key Management",
		description:
			"One dashboard for all your provider keys—no more scattered credentials or exposed secrets.",
		slug: "secure-key-management",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 141"
			>
				<path
					d="m21.3493 85.4372 49.8235 5.7766 1.0679-.0084 49.7503-5.7682c8.206-.6034 23.894-7.8197 20.998-31.858.603-8.4471-5.141-25.4139-32.944-25.7035C105.459 17.2564 91.5915 0 72.0322 0h-.7239C52.1312 0 37.8816 17.2564 33.2959 27.8757 5.49266 28.1653-.251398 45.1321.351984 53.5792-2.54419 77.6175 13.1434 84.8338 21.3493 85.4372Z"
					fill="#D4CFCB"
				/>
				<path
					d="M17.377 78.7269c0-6.0751 4.9248-11 11-11h87.331c6.075 0 11 4.9249 11 11v14.2022c0 6.0751-4.925 10.9999-11 10.9999H28.377c-6.0752 0-11-4.9248-11-10.9999V78.7269ZM17.377 115.653c0-6.075 4.9248-11 11-11h87.331c6.075 0 11 4.925 11 11v14.202c0 6.075-4.925 11-11 11H28.377c-6.0752 0-11-4.925-11-11v-14.202Z"
					fill="#59595B"
				/>
				<rect
					x="28.2378"
					y="79.3116"
					width="49.959"
					height="13.0328"
					rx="6.51639"
					fill="#2F3032"
				/>
				<rect
					x="28.2378"
					y="117.686"
					width="49.959"
					height="13.0328"
					rx="6.51639"
					fill="#2F3032"
				/>
				<circle cx="107.521" cy="84.7419" r="5.43033" fill="#77B359" />
				<circle cx="106.797" cy="126.012" r="3.98224" fill="#77B359" />
			</svg>
		),
		title: "Self-hosted or Cloud",
		description:
			"Run on your own infrastructure for full control, or let us handle it—your choice.",
		slug: "self-hosted-or-cloud",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<rect x="10" y="20" width="124" height="94" rx="16" fill="#0F172A" />
				<rect x="24" y="34" width="96" height="6" rx="3" fill="#4ADE80" />
				<rect x="24" y="50" width="72" height="6" rx="3" fill="#38BDF8" />
				<rect x="24" y="66" width="54" height="6" rx="3" fill="#A855F7" />
				<circle cx="40" cy="96" r="10" fill="#22C55E" />
				<path
					d="M40 90c-3.3137 0-6 2.6863-6 6s2.6863 6 6 6 6-2.6863 6-6"
					stroke="#DCFCE7"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</svg>
		),
		title: "Cost-aware analytics",
		description:
			"See requests, tokens, total spend, and average cost per 1K tokens across 7 or 30 days.",
		slug: "cost-aware-analytics",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<rect x="14" y="22" width="116" height="100" rx="12" fill="#020617" />
				<rect x="30" y="40" width="20" height="54" rx="4" fill="#38BDF8" />
				<rect x="62" y="30" width="20" height="64" rx="4" fill="#A855F7" />
				<rect x="94" y="52" width="20" height="42" rx="4" fill="#22C55E" />
				<circle cx="38" cy="106" r="3" fill="#38BDF8" />
				<circle cx="70" cy="106" r="3" fill="#A855F7" />
				<circle cx="102" cy="106" r="3" fill="#22C55E" />
			</svg>
		),
		title: "Per‑model/provider breakdown",
		description:
			"Break down usage and spend by provider and model so you can quickly spot expensive outliers.",
		slug: "per-model-provider-breakdown",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<rect x="16" y="24" width="112" height="96" rx="12" fill="#020617" />
				<path
					d="M36 92c8 0 8-16 16-16s8 16 16 16 8-16 16-16 8 16 16 16"
					stroke="#22C55E"
					strokeWidth="3"
					strokeLinecap="round"
				/>
				<circle cx="40" cy="52" r="6" fill="#F97316" />
				<circle cx="72" cy="44" r="6" fill="#F97316" />
				<circle cx="104" cy="60" r="6" fill="#F97316" />
			</svg>
		),
		title: "Errors & reliability monitoring",
		description:
			"Monitor error rate, cache hit rate, and reliability trends directly from the dashboard.",
		slug: "errors-reliability-monitoring",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<rect x="14" y="24" width="116" height="96" rx="12" fill="#020617" />
				<rect x="30" y="40" width="84" height="14" rx="4" fill="#0EA5E9" />
				<rect x="30" y="62" width="56" height="10" rx="3" fill="#4ADE80" />
				<rect x="30" y="80" width="72" height="10" rx="3" fill="#A855F7" />
				<circle cx="40" cy="102" r="4" fill="#4ADE80" />
				<circle cx="60" cy="102" r="4" fill="#38BDF8" />
				<circle cx="80" cy="102" r="4" fill="#F97316" />
			</svg>
		),
		title: "Project‑level usage explorer",
		description:
			"Drill into each project's requests, models, errors, cache, and costs with dedicated charts and tables.",
		slug: "project-level-usage-explorer",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<rect x="24" y="16" width="96" height="112" rx="8" fill="#616163" />
				<rect x="34" y="28" width="76" height="88" rx="4" fill="#D4CFCB" />
				<rect x="44" y="42" width="56" height="6" rx="2" fill="#4ADE80" />
				<rect x="44" y="56" width="40" height="6" rx="2" fill="#38BDF8" />
				<rect x="44" y="70" width="48" height="6" rx="2" fill="#A855F7" />
				<rect x="44" y="84" width="36" height="6" rx="2" fill="#F97316" />
				<rect x="44" y="98" width="52" height="6" rx="2" fill="#22C55E" />
				<circle cx="44" cy="45" r="2" fill="#020617" />
				<circle cx="44" cy="59" r="2" fill="#020617" />
				<circle cx="44" cy="73" r="2" fill="#020617" />
				<circle cx="44" cy="87" r="2" fill="#020617" />
				<circle cx="44" cy="101" r="2" fill="#020617" />
			</svg>
		),
		title: "Enterprise Audit Logs",
		description:
			"Track who did what, when, and maintain compliance with comprehensive audit trails.",
		slug: "audit-logs",
	},
	{
		icon: (
			<svg
				className="h-8 w-8"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 144 144"
			>
				<path
					d="M72 12L24 32v40c0 33.137 21.49 62.627 48 72 26.51-9.373 48-38.863 48-72V32L72 12Z"
					fill="#616163"
				/>
				<path
					d="M72 24L36 40v28c0 26.51 17.192 50.102 36 57.6 18.808-7.498 36-31.09 36-57.6V40L72 24Z"
					fill="#4ADE80"
				/>
				<path d="M64 72l-8-8-6 6 14 14 24-24-6-6-18 18Z" fill="#020617" />
			</svg>
		),
		title: "LLM Guardrails",
		description:
			"Prevent prompt injection, detect PII, and block malicious requests with intelligent guardrails.",
		slug: "guardrails",
	},
];

export default function Features() {
	return (
		<section
			id="features"
			className="py-20 border-b border-zinc-200 dark:border-zinc-800"
		>
			<div className="container mx-auto px-4">
				<h2 className="text-3xl font-bold tracking-tight mb-12 text-center text-zinc-900 dark:text-white">
					Features
				</h2>
				<ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{features.map((feature, i) => (
						<GridItem
							key={i}
							icon={feature.icon}
							title={feature.title}
							description={feature.description}
							slug={feature.slug}
						/>
					))}
				</ul>
			</div>
		</section>
	);
}

interface GridItemProps {
	icon: ReactNode;
	title: string;
	description: ReactNode;
	slug: string;
}

const GridItem = ({ icon, title, description, slug }: GridItemProps) => {
	return (
		<li className="min-h-[14rem] list-none">
			<Link href={`/features/${slug}`} className="block h-full group">
				<div className="relative h-full rounded-[1.25rem] border-[0.75px] border-border p-2 md:rounded-[1.5rem] md:p-3 transition-transform hover:scale-[1.02]">
					<GlowingEffect
						spread={40}
						glow={true}
						disabled={false}
						proximity={64}
						inactiveZone={0.01}
						borderWidth={3}
					/>
					<div className="relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-xl border-[0.75px] bg-background p-6 shadow-sm dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)] md:p-6">
						<div className="relative flex flex-1 flex-col justify-between gap-3">
							<div className="w-fit rounded-lg border-[0.75px] border-border bg-muted p-2">
								{icon}
							</div>
							<div className="space-y-3">
								<h3 className="pt-0.5 text-xl leading-[1.375rem] font-semibold font-sans tracking-[-0.04em] md:text-2xl md:leading-[1.875rem] text-balance text-foreground">
									{title}
								</h3>
								<h2 className="[&_b]:md:font-semibold [&_strong]:md:font-semibold font-sans text-sm leading-[1.125rem] md:text-base md:leading-[1.375rem] text-muted-foreground">
									{description}
								</h2>
							</div>
						</div>
						<div className="flex items-center gap-1 text-sm font-medium text-primary">
							<span>Learn more</span>
							<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
						</div>
					</div>
				</div>
			</Link>
		</li>
	);
};
