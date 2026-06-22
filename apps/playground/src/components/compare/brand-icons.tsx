import {
	AnthropicIcon,
	GoogleStudioAIIconStatic,
	OpenAIIcon,
	PerplexityIcon,
} from "@llmgateway/shared/components";

import type { FC, SVGProps } from "react";

/**
 * Brand logos for the comparison pages. OpenAI, Anthropic, Google AI and
 * Perplexity reuse the app's existing provider icons; Poe, OpenRouter and the
 * T3 mark are real SVGs sourced from simpleicons.org and svgl.app.
 */

// Poe — simpleicons.org
export const PoeIcon: FC<SVGProps<SVGSVGElement>> = (props) => (
	<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path d="M24 12.513V8.36c0-.888-.717-1.608-1.603-1.615h-.013c-.498-.009-1.194-.123-1.688-.619-.44-.439-.584-1.172-.622-1.783l-.001.003c-.002-.014-.002-.03-.003-.044l-.001-.03a1.616 1.616 0 0 0-1.607-1.45H5.54a1.59 1.59 0 0 0-.164.008l-.055.009c-.034.004-.068.008-.102.015l-.069.017c-.028.008-.056.013-.083.022-.024.007-.045.015-.07.024-.026.01-.053.018-.08.03-.021.008-.042.02-.063.029-.027.013-.054.024-.08.038l-.059.034c-.025.015-.052.03-.077.047a.967.967 0 0 0-.061.045c-.021.015-.044.03-.065.05a1.21 1.21 0 0 0-.099.09c-.006.005-.013.01-.018.016l-.014.016a1.59 1.59 0 0 0-.094.102c-.017.02-.03.042-.046.062-.016.021-.033.042-.047.063l-.045.074-.037.062-.036.076a.682.682 0 0 0-.058.143l-.027.075-.02.074a.773.773 0 0 0-.018.078c-.006.03-.009.058-.013.088-.003.022-.008.045-.01.069-.003.022-.003.045-.004.068l-.002-.002c-.036.61-.182 1.345-.62 1.784-.496.495-1.191.61-1.69.618h-.012c-.05 0-.1.003-.147.007a1.27 1.27 0 0 0-.072.012c-.029.004-.057.007-.084.012l-.082.02-.072.018c-.026.009-.052.019-.079.027-.024.009-.048.016-.07.026-.024.01-.048.022-.072.034a.767.767 0 0 0-.072.033l-.068.04-.068.041a1.228 1.228 0 0 0-.072.054c-.018.014-.037.026-.053.04a1.627 1.627 0 0 0-.226.227c-.015.016-.027.036-.041.053a1.398 1.398 0 0 0-.054.074c-.016.022-.028.045-.041.067L.19 7.6c-.012.023-.022.047-.033.07l-.034.073c-.01.024-.017.046-.026.07-.01.027-.02.053-.027.08-.007.023-.012.047-.018.071l-.02.082-.012.084c-.003.024-.009.048-.01.072-.007.052-.01.106-.01.16v4.152c0 .888.717 1.609 1.603 1.616h.01c.5.008 1.196.123 1.69.618.43.43.577 1.143.618 1.746v4.13c0 .524.66.754.986.346l2.333-2.92h11.22c.861 0 1.563-.675 1.611-1.524l.001.003c.037-.61.183-1.344.622-1.783.495-.496 1.19-.61 1.689-.619h.012c.044 0 .088-.003.132-.007l.022-.001A1.613 1.613 0 0 0 24 12.513zm-3.85 1.69c-.502.503-1.215.613-1.717.619H5.566c-.501-.006-1.215-.114-1.717-.618-.408-.409-.565-1.117-.618-1.744V8.415c.052-.627.209-1.337.618-1.745.503-.503 1.216-.613 1.717-.619h12.867c.502.006 1.216.115 1.718.619.409.41.564 1.117.618 1.744v4.041c-.052.63-.209 1.339-.618 1.749zM8.424 7.99c-.892 0-1.615.723-1.615 1.615v1.616a1.615 1.615 0 1 0 3.23 0V9.604c0-.892-.723-1.615-1.615-1.615Zm7.154 0c-.893 0-1.616.723-1.616 1.615v1.616a1.615 1.615 0 1 0 3.231 0V9.604c0-.892-.723-1.615-1.615-1.615z" />
	</svg>
);

// OpenRouter — simpleicons.org
export const OpenRouterIcon: FC<SVGProps<SVGSVGElement>> = (props) => (
	<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z" />
	</svg>
);

// T3 Chat (T3 mark) — svgl.app
export const T3ChatIcon: FC<SVGProps<SVGSVGElement>> = (props) => (
	<svg
		viewBox="0 0 258 199"
		fill="currentColor"
		xmlns="http://www.w3.org/2000/svg"
		{...props}
	>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M165.735 25.0701L188.947 0.972412H0.465994V25.0701H165.735Z"
		/>
		<path d="M163.981 96.3239L254.022 3.68314L221.206 3.68295L145.617 80.7609L163.981 96.3239Z" />
		<path d="M233.658 131.418C233.658 155.075 214.48 174.254 190.823 174.254C171.715 174.254 155.513 161.738 150 144.439L146.625 133.848L127.329 153.143L129.092 157.336C139.215 181.421 163.034 198.354 190.823 198.354C227.791 198.354 257.759 168.386 257.759 131.418C257.759 106.937 244.399 85.7396 224.956 74.0905L220.395 71.3582L202.727 89.2528L210.788 93.5083C224.403 100.696 233.658 114.981 233.658 131.418Z" />
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M88.2625 192.669L88.2626 45.6459H64.1648L64.1648 192.669H88.2625Z"
		/>
	</svg>
);

export type BrandRenderMode = "tile" | "mark";

interface BrandEntry {
	Icon: FC<SVGProps<SVGSVGElement>>;
	/**
	 * "tile" — the icon ships its own brand-colored background; render full-bleed.
	 * "mark" — transparent mark; center it on a neutral chip, tinted by colorClass.
	 */
	mode: BrandRenderMode;
	colorClass?: string;
}

const BRANDS: Record<string, BrandEntry> = {
	chatgpt: { Icon: OpenAIIcon, mode: "tile" },
	claude: { Icon: AnthropicIcon, mode: "tile" },
	gemini: { Icon: GoogleStudioAIIconStatic, mode: "mark" },
	perplexity: {
		Icon: PerplexityIcon,
		mode: "mark",
		colorClass: "text-[#20808d]",
	},
	poe: { Icon: PoeIcon, mode: "mark", colorClass: "text-[#5d5cde]" },
	"t3-chat": { Icon: T3ChatIcon, mode: "mark", colorClass: "text-[#e0117f]" },
	openrouter: {
		Icon: OpenRouterIcon,
		mode: "mark",
		colorClass: "text-foreground",
	},
};

export function getBrand(slug: string): BrandEntry | undefined {
	return BRANDS[slug];
}
