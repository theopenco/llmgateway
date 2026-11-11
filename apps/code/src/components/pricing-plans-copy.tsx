import type { DevPlanTier } from "@llmgateway/shared";
import type { ReactNode } from "react";

export type PricingLocale = "en" | "ko";

export interface PricingCopy {
	plans: Record<
		DevPlanTier,
		{ description: string; support: string; features: string[] }
	>;
	popular: string;
	perMonth: string;
	perDay: (amount: string) => string;
	usageBadge: (ratio: string) => string;
	usageNote: (ratio: string) => string;
	catalog: [label: string, value: string];
	dailyPacing: [label: string, value: (percent: number) => string];
	frontier: [label: string, value: (percent: number) => string];
	rollover: [label: string, value: (amount: string) => string];
	support: string;
	getPlan: (name: string) => string;
	refundLine: (days: number) => string;
	/** Shown under the cards where the billing currency is not the reader's. */
	currencyNote?: string;
	pacingNote: (inputPrice: number, outputPrice: number) => string;
	guaranteeTitle: string;
	guarantee: (
		billing: (label: string) => ReactNode,
		days: number,
		percent: number,
	) => ReactNode;
	paygoLabel: string;
	paygo: (fee: string) => ReactNode;
	paygoCta: string;
	invoice: string;
	metering: string;
}

const en: PricingCopy = {
	plans: {
		lite: {
			description: "For evenings-and-weekends coding",
			support: "Email",
			features: [
				"All 100+ models — Claude, GPT-5, Gemini, GLM, Qwen, …",
				"DevPass Code, Claude Code, OpenCode, Empryo, SoulForge & any OpenAI-compatible tool",
				"Real-time dashboard with per-request cost",
			],
		},
		pro: {
			description: "For daily development work",
			support: "Priority",
			features: [
				"Everything in Lite",
				"Headroom for a full agent session every day",
				"More frontier fair-use headroom than Lite",
			],
		},
		max: {
			description: "For all-day, multi-agent workloads",
			support: "Front of queue",
			features: [
				"Everything in Pro",
				"Run agents non-stop without watching the meter",
				"Best frontier-model allowance per dollar",
			],
		},
	},
	popular: "Most popular",
	perMonth: "/mo",
	perDay: (amount) => `≈ $${amount}/day · switch or cancel anytime`,
	usageBadge: (ratio) => `${ratio} usage`,
	usageNote: (ratio) =>
		`Worth ${ratio} what you pay in model usage, metered at provider list rates.`,
	catalog: ["Model catalog", "100+ models"],
	dailyPacing: ["Daily pacing", (percent) => `${percent}% of credits / day`],
	frontier: ["Frontier fair-use", (percent) => `${percent}% of credits / week`],
	rollover: ["Unused carries over", (amount) => `up to ${amount}`],
	support: "Support",
	getPlan: (name) => `Get ${name}`,
	refundLine: (days) => `${days}-day self-serve refund · no lock-in`,
	pacingNote: (inputPrice, outputPrice) =>
		`Daily pacing spreads your allowance across the cycle: each rolling 24-hour window can use the share of monthly credits shown on the card, across every model. Frontier fair-use covers premium models — any model priced at $${inputPrice}+ per million input tokens or $${outputPrice}+ per million output tokens after any active public discount — as a weekly allowance on top. Every other model draws on your full monthly allowance, and what you leave unused at renewal carries into the next cycle up to the amount on the card. No hidden throttling. And none of it is a wall: opt into pay-as-you-go overflow in your dashboard to keep coding past any of them, billed from a credits balance at provider rates.`,
	guaranteeTitle: "First-month guarantee",
	guarantee: (billing, days, percent) => (
		<>
			Try DevPass for real. If it&apos;s not for you, refund yourself from{" "}
			{billing("Billing")} in your dashboard — a full refund of your first
			month, up to {days} days after purchase, as long as you&apos;ve used less
			than {percent}% of your allowance. One click, no email, no cancellation
			fee.
		</>
	),
	paygoLabel: "No subscription? Pay as you go",
	paygo: (fee) => (
		<>
			The same 100+ models are on{" "}
			<span className="font-semibold text-foreground">LLM Gateway</span> without
			a plan — top up credits and pay per token at provider rates with a flat{" "}
			{fee} platform fee, or bring your own provider keys for free. DevPass
			simply doubles every dollar.
		</>
	),
	paygoCta: "Use pay-as-you-go",
	invoice:
		"Need company/address details on your invoice? Update billing settings before purchase. We email the invoice automatically after payment.",
	metering:
		"Usage is metered at each provider's published per-token rate. Every request shows its dollar value in your dashboard in real time.",
};

/** "2×" as Korean reads it: "2배". */
export const toKoreanRatio = (ratio: string) => ratio.replace("×", "배");

const ko: PricingCopy = {
	plans: {
		lite: {
			description: "저녁과 주말에 코딩하는 분께",
			support: "이메일",
			features: [
				"Claude, GPT, Gemini를 비롯한 모든 모델",
				"DevPass Code, Claude Code, OpenCode, Empryo, SoulForge 등 OpenAI 호환 코딩 도구",
				"요청마다 비용을 보여 주는 실시간 대시보드",
			],
		},
		pro: {
			description: "매일 개발하는 분께",
			support: "우선 지원",
			features: [
				"Lite의 모든 기능",
				"매일 에이전트 세션을 끝까지 돌릴 수 있는 한도",
				"Lite보다 넉넉한 프런티어 모델 한도",
			],
		},
		max: {
			description: "하루 종일 여러 에이전트를 돌리는 분께",
			support: "최우선 지원",
			features: [
				"Pro의 모든 기능",
				"사용량을 신경 쓰지 않고 에이전트를 계속 실행",
				"금액 대비 가장 큰 프런티어 모델 한도",
			],
		},
	},
	popular: "가장 인기",
	perMonth: "/월",
	perDay: (amount) => `하루 약 $${amount} · 언제든 변경·해지`,
	usageBadge: (ratio) => `사용량 ${toKoreanRatio(ratio)}`,
	usageNote: (ratio) =>
		`결제 금액의 ${toKoreanRatio(ratio)}만큼 모델을 쓰고, 사용량은 제공사 공식 요금으로 계산합니다.`,
	catalog: ["모델 카탈로그", "100개 이상"],
	dailyPacing: ["일일 사용 한도", (percent) => `하루에 크레딧의 ${percent}%`],
	frontier: ["프런티어 공정 사용", (percent) => `주당 크레딧의 ${percent}%`],
	rollover: ["미사용분 이월", (amount) => `최대 ${amount}`],
	support: "지원",
	getPlan: (name) => `${name} 시작하기`,
	refundLine: (days) => `${days}일 안에 직접 환불 · 약정 없음`,
	currencyNote:
		"모든 요금은 미국 달러(USD)로 청구됩니다. 원화 청구 금액은 카드사 환율과 해외 결제 수수료에 따라 달라집니다.",
	pacingNote: (inputPrice, outputPrice) =>
		`일일 사용 한도는 월 한도가 한꺼번에 소진되지 않도록 결제 주기에 걸쳐 나눠 줍니다. 연속된 24시간 동안 요금제 카드에 표시된 비율만큼의 월 크레딧을 모든 모델에 쓸 수 있습니다. 프런티어 공정 사용은 프리미엄 모델에 추가로 적용되는 주간 한도입니다. 공개 할인을 적용한 뒤 입력 100만 토큰당 $${inputPrice} 이상이거나 출력 100만 토큰당 $${outputPrice} 이상인 모델이 프리미엄 모델입니다. 그 밖의 모델은 월 한도 전체를 쓰고, 갱신할 때 남은 한도는 요금제 카드에 표시된 금액까지 다음 주기로 이월됩니다. 숨은 속도 제한은 없습니다. 한도에 닿더라도 대시보드에서 종량제 초과 사용을 켜면 크레딧 잔액에서 제공사 요금으로 계속 코딩할 수 있습니다.`,
	guaranteeTitle: "첫 달 환불 보장",
	guarantee: (billing, days, percent) => (
		<>
			DevPass를 제대로 써 보세요. 맞지 않으면 대시보드의{" "}
			{billing("Billing(결제) 메뉴")}에서 직접 환불할 수 있습니다. 한도의{" "}
			{percent}% 미만을 썼다면 구매 후 {days}일 안에 첫 달 요금을 전액
			돌려받습니다. 클릭 한 번이면 되고, 이메일을 보낼 필요도, 해지 수수료도
			없습니다.
		</>
	),
	paygoLabel: "구독 없이 종량제로",
	paygo: (fee) => (
		<>
			같은 모델을{" "}
			<span className="font-semibold text-foreground">LLM Gateway</span>에서
			요금제 없이 쓸 수 있습니다. 크레딧을 충전해 제공사 요금에 플랫폼 수수료{" "}
			{fee}를 더해 토큰 단위로 결제하거나, 직접 가진 제공사 키를 무료로
			연결하세요. DevPass는 같은 금액으로 두 배를 쓰게 해 줍니다.
		</>
	),
	paygoCta: "종량제로 쓰기",
	invoice:
		"인보이스에 회사명이나 주소가 필요하면 구매 전에 결제 설정에서 입력하세요. 결제가 끝나면 인보이스를 이메일로 자동 발송합니다.",
	metering:
		"사용량은 각 제공사가 공개한 토큰 단가로 계산합니다. 모든 요청의 달러 금액을 대시보드에서 실시간으로 볼 수 있습니다.",
};

export const pricingCopy: Record<PricingLocale, PricingCopy> = { en, ko };
