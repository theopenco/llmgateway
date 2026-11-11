import { Check, X } from "lucide-react";
import Link from "next/link";

import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { CodeCTATracker, KoreanPageTracker } from "@/components/LandingTracker";
import { PricingPlans } from "@/components/PricingPlans";
import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Marquee } from "@/components/ui/marquee";
import { marqueeTools } from "@/lib/agent-tools";
import { buildDevPassProductSchema } from "@/lib/product-schema";

import {
	DEV_PLAN_PRICES,
	DEV_PLAN_RENEWAL_ROLLOVER_PERCENT,
	getDevPlanCreditsLimit,
	MARKETING_STATS,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
} from "@llmgateway/shared";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const title = "AI 코딩 구독 DevPass | 요금제 하나로 모든 모델";
const description = `Claude, GPT, Gemini를 비롯한 모든 모델을 지금 쓰는 코딩 에이전트에서 그대로. 월 $${DEV_PLAN_PRICES.lite}부터 시작하는 정액제 AI 코딩 구독 DevPass.`;

export const metadata: Metadata = {
	title: { absolute: title },
	description,
	alternates: {
		canonical: "/ko",
		languages: { en: "/", ko: "/ko", "x-default": "/" },
	},
	openGraph: {
		title,
		description,
		url: "/ko",
		locale: "ko_KR",
		type: "website",
		siteName: "DevPass by LLM Gateway",
		images: ["/opengraph.png?v=2"],
	},
	twitter: { card: "summary_large_image", title, description },
};

const cta = { signedOut: "DevPass 시작하기", signedIn: "대시보드로 이동" };
const ctaClassName =
	"gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400";

const steps = [
	{
		step: "01",
		title: "요금제를 고릅니다",
		description: `Lite, Pro, Max 가운데 하나를 고르세요. 월 $${DEV_PLAN_PRICES.lite}부터 시작하는 정액제이고, 언제든 바꾸거나 해지할 수 있습니다.`,
	},
	{
		step: "02",
		title: "에이전트에 키를 넣습니다",
		description:
			"Claude Code는 환경 변수 두 개, OpenCode는 /connect, Empryo는 /keys면 됩니다. DevPass Code에서는 클릭 한 번으로 로그인합니다. SDK를 바꿀 필요가 없습니다.",
	},
	{
		step: "03",
		title: "원하는 모델로 코딩합니다",
		description:
			"Claude, GPT, Gemini를 비롯한 모든 모델을 같은 키로 자유롭게 바꿔 가며 씁니다.",
	},
] as const;

const directItems = [
	{ label: "Claude 구독", value: "보통 월 $100~200" },
	{ label: "두 번째 에이전트 요금제", value: "보통 월 $20 안팎" },
	{ label: "다른 모델용 API 키", value: "예측하기 어려운 청구액" },
	{ label: "쓸 수 있는 모델", value: "제공사마다 따로" },
] as const;

const devpassItems = [
	{
		label: "모든 모델",
		value: `모델 100개 이상, 제공사 ${MARKETING_STATS.providers}`,
	},
	{ label: "정액 요금", value: `월 $${DEV_PLAN_PRICES.lite}부터` },
	{ label: "사용량 측정", value: "제공사 공시 요금 그대로" },
	{ label: "약정", value: "없음, 언제든 해지" },
] as const;

const faqItems: { question: string; answer: string; content?: ReactNode }[] = [
	{
		question: "DevPass는 어떤 코딩 에이전트에서 쓸 수 있나요?",
		answer:
			"OpenAI 또는 Anthropic API를 쓰는 도구라면 모두 됩니다. DevPass Code, Claude Code, OpenCode, GitHub Copilot, Empryo, SoulForge, Cursor, Cline, Continue, Aider, OpenAI와 Anthropic SDK에서 쓸 수 있습니다. 환경 변수 두 개만 설정하면 됩니다.",
	},
	{
		question: "어떤 모델이 포함되나요?",
		answer:
			"모든 요금제에 Claude, GPT, Gemini를 비롯한 전체 모델 카탈로그가 포함됩니다. 요금제마다 다른 것은 월 사용 한도, 일일 사용 한도, 프리미엄 프런티어 모델의 주간 공정 사용 한도입니다.",
	},
	{
		question: "원화로 결제할 수 있나요?",
		answer:
			"요금은 미국 달러(USD)로 청구되며, 해외 결제가 되는 신용카드나 체크카드로 결제합니다. 원화 청구 금액은 카드사 환율과 해외 결제 수수료에 따라 달라집니다.",
	},
	{
		question: "쓰지 않은 한도는 다음 달로 넘어가나요?",
		answer: `네. 갱신할 때 남아 있는 한도는 요금제 월 한도의 ${Math.round(DEV_PLAN_RENEWAL_ROLLOVER_PERCENT * 100)}%까지 다음 결제 주기로 이월됩니다.`,
	},
	{
		question: "사용량은 어떻게 측정되나요?",
		answer:
			"각 제공사가 공시한 토큰 단가(입력, 출력, 캐시 토큰)로 측정합니다. 모든 요청의 달러 금액을 대시보드에서 실시간으로 확인할 수 있습니다.",
	},
	{
		question: "요청을 처리할 제공사를 직접 고를 수 있나요?",
		answer:
			"아니요. DevPass는 항상 스마트 라우팅을 씁니다. 모델 ID만 지정하면 게이트웨이가 가동률, 속도, 가격, 프롬프트 캐싱을 기준으로 가장 알맞은 제공사를 실시간으로 고릅니다. 제공사나 리전을 고정해야 한다면 LLM Gateway의 종량제 API를 이용하세요.",
		content: (
			<>
				아니요. DevPass는 항상 스마트 라우팅을 씁니다. 모델 ID만 지정하면
				게이트웨이가 가동률, 속도, 가격, 프롬프트 캐싱을 기준으로 가장 알맞은
				제공사를 실시간으로 고릅니다. 제공사나 리전을 고정해야 한다면{" "}
				<a href="https://llmgateway.io" className="underline">
					LLM Gateway의 종량제 API
				</a>
				를 이용하세요.
			</>
		),
	},
	{
		question: "첫 달 보장은 무엇인가요?",
		answer: `DevPass가 맞지 않고 월 한도의 ${SELF_REFUND_USAGE_PERCENT}% 미만을 썼다면, 구매 후 ${SELF_REFUND_WINDOW_DAYS}일 안에 대시보드의 결제 메뉴에서 직접 환불할 수 있습니다. 첫 달 요금을 전액 돌려받고, 환불하면 요금제는 바로 종료되며 해지 수수료는 없습니다.`,
	},
	{
		question: "인보이스를 받을 수 있나요?",
		answer:
			"결제가 끝나면 인보이스를 이메일로 자동 발송합니다. 인보이스에 회사명이나 주소가 필요하면 구매 전에 결제 설정에서 입력하세요.",
	},
];

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
			{children}
		</p>
	);
}

export default function KoreanLandingPage() {
	const credits = {
		lite: getDevPlanCreditsLimit("lite"),
		pro: getDevPlanCreditsLimit("pro"),
		max: getDevPlanCreditsLimit("max"),
	};
	const usageRatio = credits.lite / DEV_PLAN_PRICES.lite;
	const refundNote = `첫 달 보장: 한도의 ${SELF_REFUND_USAGE_PERCENT}% 미만을 썼다면 첫 결제 후 ${SELF_REFUND_WINDOW_DAYS}일 안에 결제 대시보드에서 직접 환불할 수 있습니다.`;

	const schemaJson = JSON.stringify([
		{
			...buildDevPassProductSchema("https://devpass.llmgateway.io/ko#pricing"),
			description,
			inLanguage: "ko",
		},
		{
			"@context": "https://schema.org",
			"@type": "FAQPage",
			inLanguage: "ko",
			mainEntity: faqItems.map((item) => ({
				"@type": "Question",
				name: item.question,
				acceptedAnswer: { "@type": "Answer", text: item.answer },
			})),
		},
	]).replace(/</g, "\\u003c");

	return (
		<div lang="ko" className="min-h-screen break-keep bg-background">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: schemaJson }}
			/>
			<KoreanPageTracker />
			<Header />

			<main>
				<section className="relative overflow-hidden">
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-30 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent_70%)]"
					/>
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_10%,rgba(16,185,129,0.09),transparent_60%)]"
					/>
					<div className="container relative mx-auto px-4 pt-16 pb-16 sm:pt-24 sm:pb-20">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
								<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
								AI 코딩 구독 · 월 ${DEV_PLAN_PRICES.lite}부터
							</div>
							<h1 className="font-display mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
								AI 코딩 구독 하나로
								<br />
								<span className="text-muted-foreground">
									모든 모델, 모든 에이전트
								</span>
							</h1>
							<p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
								Claude, GPT, Gemini를 비롯한 모든 모델을 지금 쓰는 코딩
								에이전트에서 그대로 쓰세요. 결제한 금액의 {usageRatio}배만큼
								모델을 쓸 수 있습니다.
							</p>
							<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
								<GetDevPassButton
									cta="get_started"
									location="ko_hero"
									signupHref="/signup?plan=lite"
									labels={cta}
									showArrow
									className={ctaClassName}
								/>
								<CodeCTATracker cta="see_plans" location="ko_hero">
									<Button size="lg" variant="outline" asChild>
										<Link href="#pricing">요금제 보기</Link>
									</Button>
								</CodeCTATracker>
							</div>
							<p className="mt-5 text-xs text-muted-foreground">{refundNote}</p>
						</div>
					</div>
				</section>

				<section className="border-y bg-muted/20 py-12">
					<p className="mb-8 text-center text-xs font-medium tracking-wide text-muted-foreground">
						지금 쓰는 에이전트에서 그대로
					</p>
					<div className="relative">
						<div
							aria-hidden
							className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent"
						/>
						<div
							aria-hidden
							className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent"
						/>
						<Marquee pauseOnHover className="[--duration:36s] [--gap:3.5rem]">
							{marqueeTools.map((tool) => (
								<span
									key={tool.name}
									className="flex items-center gap-2.5 font-mono text-sm text-muted-foreground"
								>
									{"icon" in tool && tool.icon ? (
										<tool.icon className="h-4.5 w-4.5" />
									) : (
										<span className="h-1 w-1 rounded-full bg-emerald-500/70" />
									)}
									{tool.name}
								</span>
							))}
							<span className="flex items-center gap-2.5 font-mono text-sm text-muted-foreground">
								<span className="h-1 w-1 rounded-full bg-emerald-500/70" />
								OpenAI 호환 도구 전부
							</span>
						</Marquee>
					</div>
					<p className="container mx-auto mt-10 px-4 text-center text-xs text-muted-foreground">
						오픈소스 LLM Gateway 위에서 동작합니다 · 누적 라우팅{" "}
						{MARKETING_STATS.tokensRouted} 토큰 · GitHub 스타{" "}
						{MARKETING_STATS.githubStars}
					</p>
				</section>

				<section className="px-4 py-20 sm:py-24">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-14 text-center">
							<SectionLabel>사용 방법</SectionLabel>
							<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
								몇 분이면 모든 모델로 코딩합니다
							</h2>
						</div>
						<div className="grid gap-10 md:grid-cols-3 md:gap-6">
							{steps.map((item) => (
								<div
									key={item.step}
									className="relative border-t border-dashed pt-6"
								>
									<span className="font-display absolute -top-5 left-0 bg-background pr-3 text-3xl font-bold tabular-nums text-emerald-600/80 dark:text-emerald-400/80">
										{item.step}
									</span>
									<h3 className="mb-2 font-semibold">{item.title}</h3>
									<p className="text-sm leading-relaxed text-muted-foreground">
										{item.description}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="border-t bg-muted/20 px-4 py-20 sm:py-24">
					<div className="container mx-auto max-w-4xl">
						<div className="mx-auto mb-12 max-w-2xl text-center">
							<SectionLabel>비용 비교</SectionLabel>
							<h2 className="font-display mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
								구독을 여러 개 쌓지 마세요
							</h2>
							<p className="text-muted-foreground">
								모델을 둘 이상 쓰려면 보통 여러 곳에 따로 결제해야 합니다.
								DevPass는 그 구독들을 사용량 기반 요금제 하나로 바꿉니다.
							</p>
						</div>
						<div className="grid gap-5 md:grid-cols-2">
							<div className="rounded-2xl border bg-card p-7">
								<p className="mb-5 text-xs font-medium tracking-wide text-muted-foreground">
									제공사에 따로 결제할 때
								</p>
								<dl className="divide-y divide-dashed divide-border text-sm">
									{directItems.map((item) => (
										<div
											key={item.label}
											className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
										>
											<dt className="flex items-center gap-2 text-muted-foreground">
												<X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
												{item.label}
											</dt>
											<dd className="text-right">{item.value}</dd>
										</div>
									))}
								</dl>
								<p className="mt-5 text-sm leading-relaxed text-muted-foreground">
									구독도 여러 개, 키도 여러 개입니다. 그런데도 각 구독은 자기
									회사 모델만 쓸 수 있습니다.
								</p>
							</div>
							<div className="rounded-2xl border border-emerald-500/40 bg-card p-7 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20">
								<p className="mb-5 text-xs font-medium tracking-wide text-emerald-600 dark:text-emerald-400">
									DevPass 구독 하나
								</p>
								<dl className="divide-y divide-dashed divide-border text-sm">
									{devpassItems.map((item) => (
										<div
											key={item.label}
											className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
										>
											<dt className="flex items-center gap-2 text-muted-foreground">
												<Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
												{item.label}
											</dt>
											<dd className="text-right font-semibold">{item.value}</dd>
										</div>
									))}
								</dl>
								<p className="mt-5 text-sm leading-relaxed text-muted-foreground">
									결제한 금액의 {usageRatio}배에 해당하는 모델 사용량을 각
									제공사의 공시 토큰 단가로 측정합니다.
								</p>
							</div>
						</div>
						<p className="mt-4 text-center text-xs text-muted-foreground">
							다른 회사의 가격은 일반적으로 공개된 요금이며 회사와 등급에 따라
							다릅니다.
						</p>
					</div>
				</section>

				<section
					id="pricing"
					className="scroll-mt-16 border-t px-4 py-20 sm:py-24"
				>
					<div className="container mx-auto max-w-6xl">
						<div className="mx-auto mb-14 max-w-2xl text-center">
							<SectionLabel>요금제</SectionLabel>
							<h2 className="font-display mb-4 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
								정액 요금제 세 가지, 모델은 전부
							</h2>
							<p className="text-muted-foreground">
								모든 요금제에 전체 모델 카탈로그가 포함됩니다. 달라지는 것은 월
								사용 한도, 일일 사용 한도, 프리미엄 모델의 주간 공정 사용
								한도뿐입니다.
							</p>
						</div>
						<PricingPlans credits={credits} locale="ko" />
					</div>
				</section>

				<section className="border-t bg-muted/20 px-4 py-20 sm:py-24">
					<div className="container mx-auto max-w-3xl">
						<div className="mb-10 text-center">
							<SectionLabel>자주 묻는 질문</SectionLabel>
							<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
								궁금한 점을 확인하세요
							</h2>
						</div>
						<div className="divide-y divide-border/60 border-y border-border/60">
							{faqItems.map((item) => (
								<details key={item.question} className="group py-5">
									<summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium sm:text-lg [&::-webkit-details-marker]:hidden">
										{item.question}
										<span
											aria-hidden
											className="shrink-0 text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
										>
											+
										</span>
									</summary>
									<p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
										{item.content ?? item.answer}
									</p>
								</details>
							))}
						</div>
					</div>
				</section>

				<section className="relative overflow-hidden border-t px-4 py-24 sm:py-28">
					<FlickeringGrid
						className="absolute inset-0 [mask-image:radial-gradient(560px_circle_at_center,white,transparent)]"
						squareSize={4}
						gridGap={6}
						color="#10b981"
						maxOpacity={0.18}
						flickerChance={0.1}
					/>
					<div className="container relative mx-auto max-w-2xl text-center">
						<h2 className="font-display mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
							구독 하나, 모든 모델
						</h2>
						<p className="mb-9 text-lg text-muted-foreground">
							요금제를 고르고 키를 넣은 다음, 다시 개발에 집중하세요.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								cta="get_started"
								location="ko_bottom_cta"
								signupHref="/signup?plan=lite"
								labels={cta}
								showArrow
								className={ctaClassName}
							/>
							<CodeCTATracker cta="see_plans" location="ko_bottom_cta">
								<Button size="lg" variant="ghost" asChild>
									<Link href="#pricing">요금제 비교</Link>
								</Button>
							</CodeCTATracker>
						</div>
						<p className="mt-6 text-xs text-muted-foreground">{refundNote}</p>
					</div>
				</section>
			</main>

			<Footer newsletter={false} />
		</div>
	);
}
