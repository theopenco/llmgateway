import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workRoot =
	process.env.BENCH_HOME ?? join(homedir(), "agent-benchmark-work");
const { repo, tasks } = JSON.parse(
	readFileSync(join(here, "tasks.json"), "utf8"),
);
const sh = (cmd, args, cwd, stderr = "inherit") =>
	execFileSync(cmd, args, {
		cwd,
		stdio: ["ignore", "pipe", stderr],
	}).toString();
const openssl = (args) => sh("openssl", args, undefined, "ignore");

mkdirSync(workRoot, { recursive: true });
const source = join(workRoot, "source");
if (!existsSync(source)) {
	sh("git", ["clone", "--filter=blob:none", "--quiet", repo, source]);
}
for (const task of tasks) {
	const base = join(workRoot, "bases", task.id);
	if (existsSync(join(base, "node_modules"))) {
		continue;
	}
	mkdirSync(base, { recursive: true });
	execFileSync("sh", [
		"-c",
		`git -C "${source}" archive ${task.fixCommit}^ | tar -x -C "${base}"`,
	]);
	sh("bun", ["install", "--frozen-lockfile"], base);
	for (const file of task.hiddenTests) {
		const hidden = join(workRoot, "hidden", task.id, file);
		mkdirSync(dirname(hidden), { recursive: true });
		writeFileSync(
			hidden,
			sh("git", ["show", `${task.fixCommit}:${file}`], source),
		);
	}
	console.log(`prepared ${task.id} at ${task.fixCommit}^`);
}

const certs = join(workRoot, "certs");
if (!existsSync(join(certs, "leaf.crt"))) {
	mkdirSync(certs, { recursive: true });
	const caKey = join(certs, "ca-private.key");
	const leafKey = join(certs, "leaf-private.key");
	openssl([
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		caKey,
		"-out",
		join(certs, "ca.crt"),
		"-days",
		"30",
		"-subj",
		"/CN=Agent Benchmark Local CA",
		"-addext",
		"basicConstraints=critical,CA:TRUE",
		"-addext",
		"keyUsage=critical,keyCertSign,cRLSign",
	]);
	openssl([
		"req",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		leafKey,
		"-out",
		join(certs, "leaf.csr"),
		"-subj",
		"/CN=api.llmgateway.io",
	]);
	writeFileSync(
		join(certs, "leaf.ext"),
		"subjectAltName=DNS:api.llmgateway.io\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n",
	);
	openssl([
		"x509",
		"-req",
		"-in",
		join(certs, "leaf.csr"),
		"-CA",
		join(certs, "ca.crt"),
		"-CAkey",
		caKey,
		"-CAcreateserial",
		"-out",
		join(certs, "leaf.crt"),
		"-days",
		"30",
		"-extfile",
		join(certs, "leaf.ext"),
	]);
	console.log(`generated a local CA in ${certs}`);
}
const empryoBin =
	process.env.EMPRYO_BIN ?? join(homedir(), ".empryo", "bin", "empryo");
const empryoRuntime = dirname(dirname(empryoBin));
for (const task of tasks) {
	const base = join(workRoot, "bases", task.id);
	const index = join(base, ".empryo");
	if (!existsSync(empryoBin) || existsSync(join(index, "genome.db"))) {
		continue;
	}
	const home = mkdtempSync(join(tmpdir(), "empryo-index-"));
	const empryoHome = join(home, ".empryo");
	mkdirSync(empryoHome, { recursive: true });
	for (const dir of [
		"bin",
		"native",
		"wasm",
		"engines",
		"installs",
		"deps",
		"opentui-assets",
		"locales",
	]) {
		if (existsSync(join(empryoRuntime, dir))) {
			symlinkSync(join(empryoRuntime, dir), join(empryoHome, dir));
		}
	}
	spawnSync(
		empryoBin,
		[
			"--headless",
			"--json",
			"--mode",
			"auto",
			"--model",
			"llmgateway/claude-opus-5-5",
			"--cwd",
			base,
			"index",
		],
		{
			cwd: base,
			env: {
				PATH: process.env.PATH,
				HOME: home,
				EMPRYO_HOME: empryoHome,
				EMPRYO_TELEMETRY: "0",
				LLM_GATEWAY_API_KEY: "index-only",
			},
			stdio: "ignore",
		},
	);
	rmSync(home, { recursive: true, force: true });
	if (!existsSync(join(index, "genome.db"))) {
		throw new Error(`Empryo did not index ${task.id}`);
	}
	for (const entry of readdirSync(index)) {
		if (!entry.startsWith("genome.db")) {
			rmSync(join(index, entry), { recursive: true, force: true });
		}
	}
	console.log(`indexed ${task.id} for Empryo`);
}
console.log(`ready: ${workRoot}`);
