// Shared by pr-risk.yml. Pure functions only: the workflow does the GitHub
// API calls so this file can be exercised with plain node.

// Maintainers whose changes take the lighter review path. Everyone else needs
// a maintainer approval regardless of tier.
export const TRUSTED_AUTHORS = ["smakosh", "steebchen"];

export const LABELS = {
	high: {
		name: "risk: high",
		color: "d73a4a",
		description: "High-risk change; needs a maintainer approval",
	},
	medium: {
		name: "risk: medium",
		color: "fbca04",
		description: "Moderate-risk change",
	},
	low: { name: "risk: low", color: "0e8a16", description: "Low-risk change" },
};

export const RANK = { low: 0, medium: 1, high: 2 };

// Paths where a mistake costs money, data or access, regardless of size.
export const HIGH_PATHS = [
	/^packages\/db\/migrations\//,
	/^packages\/db\/src\/schema\.ts$/,
	/^apps\/api\/src\/auth\//,
	/^apps\/api\/src\/routes\/(payments|platform-webhooks|stripe)/,
	/^\.github\/workflows\//,
	/^\.github\/scripts\//,
];

export const MEDIUM_PATHS = [
	/^apps\/gateway\/src\//,
	/^apps\/api\/src\//,
	/^apps\/worker\/src\//,
	/^packages\/actions\/src\//,
	/^ee\/guardrails\/src\//,
];

export const GENERATED =
	/(^|\/)(pnpm-lock\.yaml|snapshot\.json)$|\.(png|jpe?g|webp|svg|csv)$/;

export const STATUS_CONTEXT = "risk-gate";

export function isTrusted(login) {
	return TRUSTED_AUTHORS.includes(String(login ?? "").toLowerCase());
}

// CodeRabbit's walkthrough ends with "**Merge Risk:** **⚪ Minimal**",
// "🔵 Low", "🟡 Moderate", or a higher level.
export function parseCodeRabbitLevel(body) {
	const match = String(body ?? "").match(
		/\*\*Merge Risk:\*\*\s*\*\*[^A-Za-z]*([A-Za-z]+)/,
	);
	const level = match?.[1]?.toLowerCase() ?? "";
	if (!level) {
		return undefined;
	}
	if (["minimal", "low"].includes(level)) {
		return "low";
	}
	if (["moderate", "medium"].includes(level)) {
		return "medium";
	}
	return "high";
}

// files: [{ filename, additions, deletions }]
export function classifyRisk({ files, codeRabbitLevel, author }) {
	const paths = files.map((f) => f.filename);
	const changedLines = files
		.filter((f) => !GENERATED.test(f.filename))
		.reduce((sum, f) => sum + f.additions + f.deletions, 0);

	let fromPaths = "low";
	if (paths.some((p) => HIGH_PATHS.some((re) => re.test(p)))) {
		fromPaths = "high";
	} else if (
		paths.some((p) => MEDIUM_PATHS.some((re) => re.test(p))) ||
		changedLines > 1000
	) {
		fromPaths = "medium";
	}

	// Outside authors never get the low tier: a docs-only PR from a fork still
	// gets a maintainer's eyes.
	const floor = isTrusted(author) ? "low" : "medium";
	const candidates = [fromPaths, codeRabbitLevel ?? "low", floor];
	const risk = candidates.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));

	return {
		risk,
		fromPaths,
		fromCodeRabbit: codeRabbitLevel,
		changedLines,
		paths,
	};
}

// Picks the maintainer to ask, rotating by PR number and never the author.
export function pickReviewer(number, author) {
	const candidates = TRUSTED_AUTHORS.filter(
		(r) => r !== String(author ?? "").toLowerCase(),
	);
	return candidates.length ? candidates[number % candidates.length] : undefined;
}

// reviews: GitHub pull review objects in submission order. An approval counts
// only when it is a maintainer's latest review and it covers the current head
// commit; a push after approval needs a fresh look.
export function gateDecision({ labels, author, reviews, headSha }) {
	const high = labels.includes(LABELS.high.name);
	const trusted = isTrusted(author);
	if (!high && trusted) {
		return {
			state: "success",
			description: labels.some((l) => l.startsWith("risk: "))
				? "no maintainer approval required"
				: "no risk label yet; classified as low until CodeRabbit reviews",
		};
	}

	const latest = new Map();
	for (const review of reviews) {
		const login = review.user?.login?.toLowerCase();
		if (!login || login === String(author).toLowerCase() || !isTrusted(login)) {
			continue;
		}
		if (
			!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)
		) {
			continue;
		}
		latest.set(login, review);
	}
	const approver = [...latest.values()].find(
		(r) => r.state === "APPROVED" && r.commit_id === headSha,
	);
	if (approver) {
		return {
			state: "success",
			description: `approved at ${headSha.slice(0, 7)} by ${approver.user.login}`,
		};
	}
	const why = high ? "risk: high" : "external author";
	return {
		state: "failure",
		description: `${why}: needs a maintainer approval of the latest commit`,
	};
}
