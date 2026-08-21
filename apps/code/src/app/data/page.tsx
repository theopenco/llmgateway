import { redirect } from "next/navigation";

import { FIRST_SURVEY_YEAR } from "@/lib/model-survey";

export default function DataIndexPage() {
	const year = Math.max(new Date().getUTCFullYear(), FIRST_SURVEY_YEAR);
	redirect(`/data/${year}`);
}
