import type { ErrorAwareSampler } from "./error-aware.js";
import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Span,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

export class FinalStatusSpanProcessor implements SpanProcessor {
	public constructor(
		private readonly processor: SpanProcessor,
		private readonly sampler: ErrorAwareSampler,
	) {}

	public onStart(span: Span, parentContext: Context): void {
		this.processor.onStart(span, parentContext);
	}

	public onEnd(span: ReadableSpan): void {
		if (this.sampler.shouldExport(span)) {
			this.processor.onEnd(span);
		}
	}

	public forceFlush(): Promise<void> {
		return this.processor.forceFlush();
	}

	public shutdown(): Promise<void> {
		return this.processor.shutdown();
	}
}
