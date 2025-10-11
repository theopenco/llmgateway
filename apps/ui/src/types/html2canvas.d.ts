declare module "html2canvas" {
	export interface Html2CanvasOptions {
		backgroundColor?: string | null;
		scale?: number;
		logging?: boolean;
		useCORS?: boolean;
	}
	export default function html2canvas(
		element: HTMLElement,
		options?: Html2CanvasOptions,
	): Promise<HTMLCanvasElement>;
}
