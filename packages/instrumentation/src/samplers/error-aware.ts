import { ROOT_CONTEXT, SpanStatusCode } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";

import type { Attributes, Context, SpanKind, Link } from "@opentelemetry/api";
import type {
	ReadableSpan,
	Sampler,
	SamplingResult,
} from "@opentelemetry/sdk-trace-base";

export class ErrorAwareSampler implements Sampler {
	public constructor(
		private readonly normalSampler: Sampler,
		private readonly errorSampler: Sampler,
	) {}

	public shouldSample(
		context: Context,
		traceId: string,
		spanName: string,
		spanKind: SpanKind,
		attributes: Attributes,
		links: Link[],
	): SamplingResult {
		const normal = this.normalSampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);
		const error = this.errorSampler.shouldSample(
			context,
			traceId,
			spanName,
			spanKind,
			attributes,
			links,
		);
		return {
			decision: Math.max(normal.decision, error.decision),
			attributes: { "sampling.strategy": "final-status" },
		};
	}

	public shouldExport(span: ReadableSpan): boolean {
		if (span.attributes["sampling.forced"] === true) {
			return true;
		}
		const status =
			span.attributes["http.response.status_code"] ??
			span.attributes["http.status_code"];
		const isError =
			span.status.code === SpanStatusCode.ERROR ||
			(typeof status === "number" && status >= 400);
		const sampler = isError ? this.errorSampler : this.normalSampler;
		return (
			sampler.shouldSample(
				ROOT_CONTEXT,
				span.spanContext().traceId,
				span.name,
				span.kind,
				span.attributes,
				span.links,
			).decision === SamplingDecision.RECORD_AND_SAMPLED
		);
	}

	public toString(): string {
		return `ErrorAwareSampler{normal=${this.normalSampler.toString()}, error=${this.errorSampler.toString()}}`;
	}
}
