import {
	EXPERIMENT_ASSIGNMENT_SCRIPT,
	EXPERIMENT_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/experiments";

import type { Experiment } from "@/lib/experiments";

/**
 * Assigns the visitor's variant while the HTML is parsed. Render it above the
 * markup that depends on the variant.
 */
export function ExperimentAssignment({
	experiment,
}: {
	experiment: Experiment;
}) {
	return (
		<script
			data-cookie={experiment.cookie}
			data-attribute={experiment.attribute}
			data-control={experiment.variants[0]}
			data-treatment={experiment.variants[1]}
			data-max-age={EXPERIMENT_COOKIE_MAX_AGE_SECONDS}
			// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
			dangerouslySetInnerHTML={{ __html: EXPERIMENT_ASSIGNMENT_SCRIPT }}
		/>
	);
}
