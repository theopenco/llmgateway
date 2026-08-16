import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.cwd();
const skillsRoot = join(root, ".agents", "skills");
const claudeSkillsRoot = join(root, ".claude", "skills");
const packageJson = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
);
const rootScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const errors = [];

function fail(file, message) {
	errors.push(`${relative(root, file)}: ${message}`);
}

function skillDirectories(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
		.map((entry) => join(directory, entry.name));
}

const skills = skillDirectories(skillsRoot);
const skillNames = new Set(
	skills.map((directory) => relative(skillsRoot, directory)),
);

for (const directory of skills) {
	const skillFile = join(directory, "SKILL.md");
	if (!existsSync(skillFile)) {
		fail(directory, "missing SKILL.md");
		continue;
	}

	const content = readFileSync(skillFile, "utf8");
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/);
	if (!frontmatter) {
		fail(skillFile, "missing YAML frontmatter");
		continue;
	}

	const keys = [...frontmatter[1].matchAll(/^([a-zA-Z0-9_-]+):/gm)].map(
		(match) => match[1],
	);
	if (keys.join(",") !== "name,description") {
		fail(skillFile, "frontmatter must contain only name and description");
	}

	const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const folderName = relative(skillsRoot, directory);
	if (name !== folderName) {
		fail(
			skillFile,
			`name ${JSON.stringify(name)} does not match folder ${folderName}`,
		);
	}
	if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
		fail(skillFile, "name must be hyphen-case and at most 64 characters");
	}

	const description = frontmatter[1]
		.match(/^description:\s*(.+)$/m)?.[1]
		?.trim();
	if (!description) {
		fail(skillFile, "description must not be empty");
	} else {
		if (/[<>]/.test(description)) {
			fail(skillFile, "description must not contain angle brackets");
		}
		if (description.length > 1024) {
			fail(skillFile, "description must be at most 1024 characters");
		}
	}

	for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const target = match[1].split("#", 1)[0];
		if (!target || /^(?:https?:|mailto:|\/)/.test(target)) {
			continue;
		}
		if (!existsSync(resolve(dirname(skillFile), target))) {
			fail(skillFile, `missing relative link ${target}`);
		}
	}

	for (const match of content.matchAll(/`([a-z0-9-]+)` skill\b/g)) {
		if (!skillNames.has(match[1])) {
			fail(skillFile, `references missing repository skill ${match[1]}`);
		}
	}

	for (const match of content.matchAll(
		/`((?:apps|packages|ee|\.github)\/[^`]+|AGENTS\.md|CLAUDE\.md)`/g,
	)) {
		const target = match[1];
		if (/[<>{}*]/.test(target)) {
			continue;
		}
		if (!existsSync(join(root, target))) {
			fail(skillFile, `references missing repository path ${target}`);
		}
	}

	for (const match of content.matchAll(
		/\bpnpm(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/g,
	)) {
		const command = match[1];
		if (["exec", "install", "dlx"].includes(command)) {
			continue;
		}
		if (!rootScripts.has(command)) {
			fail(skillFile, `references missing root pnpm script ${command}`);
		}
	}
}

if (existsSync(claudeSkillsRoot)) {
	for (const entry of skillDirectories(claudeSkillsRoot)) {
		if (!lstatSync(entry).isSymbolicLink()) {
			fail(entry, "Claude skill must symlink to the canonical .agents skill");
			continue;
		}
		let target;
		try {
			target = realpathSync(entry);
		} catch {
			fail(entry, "Claude skill symlink is broken");
			continue;
		}
		if (!target.startsWith(`${realpathSync(skillsRoot)}/`)) {
			fail(entry, "Claude skill symlink points outside .agents/skills");
		}
	}

	for (const skill of skillNames) {
		if (!existsSync(join(claudeSkillsRoot, skill))) {
			fail(
				join(claudeSkillsRoot, skill),
				"missing Claude symlink to canonical .agents skill",
			);
		}
	}
}

if (errors.length) {
	console.error(errors.join("\n"));
	process.exitCode = 1;
} else {
	console.log(`Validated ${skills.length} repository skills.`);
}
