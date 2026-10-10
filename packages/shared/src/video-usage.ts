export interface VideoUsage {
	cost: number;
	cost_details: {
		video_output_cost: number;
		image_input_cost: number;
	};
}

export function buildVideoUsage(job: {
	cost: number | null;
	videoOutputCost: number | null;
	imageInputCost: number | null;
}): VideoUsage | undefined {
	if (job.cost === null) {
		return undefined;
	}
	return {
		cost: job.cost,
		cost_details: {
			video_output_cost: job.videoOutputCost ?? 0,
			image_input_cost: job.imageInputCost ?? 0,
		},
	};
}
