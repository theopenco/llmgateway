import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
	options: {
		agents: { type: "string", default: "empryo,claude-code,opencode" },
		models: { type: "string" },
		tasks: { type: "string" },
		reps: { type: "string", default: "1" },
		concurrency: { type: "string", default: "3" },
		"timeout-min": { type: "string", default: "25" },
		"max-spend": { type: "string" },
		"min-credits": { type: "string", default: "2" },
		suite: { type: "string", default: new Date().toISOString().slice(0, 10) },
	},
});

const apiKey = process.env.LLM_GATEWAY_API_KEY;
if (!apiKey) {
	throw new Error("Set LLM_GATEWAY_API_KEY");
}
const workRoot =
	process.env.BENCH_HOME ?? join(homedir(), "agent-benchmark-work");
const certs = join(workRoot, "certs");
const taskConfig = JSON.parse(readFileSync(join(here, "tasks.json"), "utf8"));
const modelConfig = JSON.parse(
	readFileSync(join(here, "models.json"), "utf8"),
).models;
const agents = opts.agents.split(",");
const modelKeys = opts.models
	? opts.models.split(",")
	: Object.keys(modelConfig);
const tasks = opts.tasks
	? taskConfig.tasks.filter((t) => opts.tasks.split(",").includes(t.id))
	: taskConfig.tasks;
const timeoutMs = Number(opts["timeout-min"]) * 60_000;
const resultsRoot = join(here, "results", opts.suite);
const scratchRoot = join(workRoot, "runs", opts.suite);
const empryoBin =
	process.env.EMPRYO_BIN ?? join(homedir(), ".empryo", "bin", "empryo");
const empryoRuntime = dirname(dirname(empryoBin));
const empryoConfig = {
	cache: { ttl: "5m", coldPrune: false },
	compaction: { onResume: false },
	heavyWork: { slots: 0 },
	agentFeatures: {
		appendOnlyInstructions: true,
		turnAudit: false,
		finishNudge: "off",
		requestMap: false,
		fixHistory: false,
		editEchoes: false,
		codeMode: "off",
		learnedResidency: "off",
	},
	skills: { autoManage: false, rememberSession: false, autoLoad: [] },
	disabledTools: ["skills"],
	liveSkills: false,
	soulstack: { autoUpdate: false },
	instructionFiles: [],
};

const sh = (cmd, args, cwd) =>
	execFileSync(cmd, args, {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 64 * 1024 * 1024,
	}).toString();

async function account() {
	try {
		const res = await fetch("https://internal.llmgateway.io/mcp/account", {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		const body = await res.json();
		return {
			usage: body.apiKey?.usageUsd ?? null,
			limit: body.apiKey?.usageLimitUsd ?? null,
			credits: body.creditsBalanceUsd ?? null,
		};
	} catch {
		return { usage: null, limit: null, credits: null };
	}
}

async function keyUsage() {
	return (await account()).usage;
}

async function budgetStop(startUsage) {
	const now = await account();
	if (now.credits !== null && now.credits < Number(opts["min-credits"])) {
		return `organization credits at $${now.credits.toFixed(2)}, below --min-credits`;
	}
	if (
		now.limit !== null &&
		now.usage !== null &&
		now.limit - now.usage < Number(opts["min-credits"])
	) {
		return `API key at $${now.usage.toFixed(2)} of its $${now.limit} limit`;
	}
	if (
		opts["max-spend"] &&
		now.usage !== null &&
		startUsage !== null &&
		now.usage - startUsage >= Number(opts["max-spend"])
	) {
		return `spent $${(now.usage - startUsage).toFixed(2)}, reached --max-spend`;
	}
	return null;
}

function startProxy(runId, logFile) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [join(here, "proxy.mjs")], {
			env: {
				...process.env,
				BENCH_RUN_ID: runId,
				BENCH_LOG_FILE: logFile,
				BENCH_PROXY_PORT: "0",
				BENCH_CERT: join(certs, "leaf.crt"),
				BENCH_KEY: join(certs, "leaf-private.key"),
			},
			stdio: ["ignore", "pipe", "inherit"],
		});
		child.stdout.once("data", (chunk) => {
			try {
				resolve({
					child,
					port: JSON.parse(chunk.toString().split("\n")[0]).port,
				});
			} catch (err) {
				reject(err);
			}
		});
		child.once("exit", (code) => reject(new Error(`proxy exited ${code}`)));
	});
}

function agentCommand(agent, model, prompt, workdir, home) {
	const gatewayId = model.gatewayId;
	if (agent === "claude-code") {
		const config = {
			ANTHROPIC_BASE_URL: "https://api.llmgateway.io",
			ANTHROPIC_MODEL: gatewayId,
			ANTHROPIC_DEFAULT_OPUS_MODEL: gatewayId,
			ANTHROPIC_DEFAULT_SONNET_MODEL: gatewayId,
			ANTHROPIC_DEFAULT_HAIKU_MODEL: gatewayId,
			CLAUDE_CODE_SUBAGENT_MODEL: gatewayId,
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			DISABLE_AUTOUPDATER: "1",
		};
		return {
			config,
			cmd: "claude",
			args: [
				"-p",
				prompt,
				"--dangerously-skip-permissions",
				"--output-format",
				"json",
			],
			env: {
				...config,
				ANTHROPIC_AUTH_TOKEN: apiKey,
				ANTHROPIC_API_KEY: "",
			},
		};
	}
	if (agent === "opencode") {
		const configDir = join(home, ".config", "opencode");
		mkdirSync(configDir, { recursive: true });
		const config = {
			$schema: "https://opencode.ai/config.json",
			provider: {
				llmgateway: {
					options: { apiKey: "{env:LLMGATEWAY_API_KEY}" },
					models: {
						[gatewayId]: {
							name: model.label,
							tool_call: true,
							reasoning: true,
						},
					},
				},
			},
			model: `llmgateway/${gatewayId}`,
			small_model: `llmgateway/${gatewayId}`,
			permission: { edit: "allow", bash: "allow", webfetch: "allow" },
			autoupdate: false,
			share: "disabled",
		};
		writeFileSync(
			join(configDir, "opencode.json"),
			JSON.stringify(config, null, 2),
		);
		return {
			config,
			cmd: "opencode",
			args: [
				"run",
				"--model",
				`llmgateway/${gatewayId}`,
				"--format",
				"json",
				"--auto",
				prompt,
			],
			env: { LLMGATEWAY_API_KEY: apiKey },
		};
	}
	if (agent === "empryo") {
		const empryoHome = join(home, ".empryo");
		mkdirSync(empryoHome, { recursive: true });
		writeFileSync(
			join(empryoHome, "config.json"),
			JSON.stringify(empryoConfig, null, 2),
		);
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
			if (
				existsSync(join(empryoRuntime, dir)) &&
				!existsSync(join(empryoHome, dir))
			) {
				symlinkSync(join(empryoRuntime, dir), join(empryoHome, dir));
			}
		}
		return {
			config: empryoConfig,
			cmd: empryoBin,
			args: [
				"--headless",
				"--json",
				"--mode",
				"auto",
				"--model",
				`llmgateway/${gatewayId}`,
				"--cwd",
				workdir,
				prompt,
			],
			env: {
				EMPRYO_HOME: empryoHome,
				LLM_GATEWAY_API_KEY: apiKey,
				EMPRYO_TELEMETRY: "0",
			},
		};
	}
	throw new Error(`unknown agent ${agent}`);
}

function runProcess(cmd, args, { cwd, env, stdoutFile, stderrFile, timeout }) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(cmd, args, {
			cwd,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = [];
		const err = [];
		child.stdout.on("data", (c) => out.push(c));
		child.stderr.on("data", (c) => err.push(c));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				process.kill(-child.pid, "SIGTERM");
				setTimeout(() => {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch {}
				}, 10_000);
			} catch {}
		}, timeout);
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			writeFileSync(stdoutFile, Buffer.concat(out));
			writeFileSync(stderrFile, Buffer.concat(err));
			resolve({ code, signal, timedOut, wallMs: Date.now() - started });
		});
	});
}

function grade(task, workdir, runDir) {
	const patch =
		sh("git", ["diff"], workdir) +
		sh(
			"sh",
			[
				"-c",
				"git ls-files --others --exclude-standard | xargs -I{} git diff --no-index /dev/null {} || true",
			],
			workdir,
		);
	writeFileSync(join(runDir, "patch.diff"), patch);
	for (const file of task.hiddenTests) {
		cpSync(join(workRoot, "hidden", task.id, file), join(workdir, file));
	}
	let output = "";
	let passed = false;
	try {
		output = sh(
			"./node_modules/.bin/vitest",
			[
				"--run",
				"--project",
				"main",
				"--coverage.enabled=false",
				task.testTarget,
			],
			workdir,
		);
		passed = true;
	} catch (err) {
		output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
	}
	writeFileSync(join(runDir, "grade.log"), output);
	const tests =
		/Tests\s+(.+?)\s*\(/.exec(output.replace(/\x1b\[[0-9;]*m/g, ""))?.[1] ??
		null;
	return {
		passed,
		tests,
		patchLines: patch.split("\n").filter((l) => /^[+-][^+-]/.test(l)).length,
	};
}

async function runOne({ task, agent, modelKey, rep }) {
	const model = modelConfig[modelKey];
	const runId = `${task.id}__${agent}__${modelKey}__r${rep}`;
	const runDir = join(resultsRoot, runId);
	if (existsSync(join(runDir, "result.json"))) {
		console.log(`skip ${runId}`);
		return;
	}
	mkdirSync(runDir, { recursive: true });
	const scratch = join(scratchRoot, runId);
	rmSync(scratch, { recursive: true, force: true });
	const workdir = join(scratch, "repo");
	const home = join(scratch, "home");
	mkdirSync(home, { recursive: true });
	const shellPath = `export PATH="${process.env.PATH}"\n`;
	for (const rc of [
		".zprofile",
		".zshrc",
		".bash_profile",
		".bashrc",
		".profile",
	]) {
		writeFileSync(join(home, rc), shellPath);
	}
	sh("cp", ["-c", "-R", join(workRoot, "bases", task.id), workdir]);
	sh("git", ["init", "-q"], workdir);
	writeFileSync(join(workdir, ".git", "info", "exclude"), ".empryo/\n");
	sh("git", ["add", "-A"], workdir);
	sh(
		"git",
		[
			"-c",
			"user.email=bench@example.com",
			"-c",
			"user.name=bench",
			"commit",
			"-qm",
			"base",
		],
		workdir,
	);

	const logFile = join(runDir, "requests.jsonl");
	rmSync(logFile, { force: true });
	const proxy = await startProxy(runId, logFile);
	const prompt = task.prompt + taskConfig.suffix;
	const command = agentCommand(agent, model, prompt, workdir, home);
	const proxyUrl = `http://127.0.0.1:${proxy.port}`;
	const env = {
		PATH: process.env.PATH,
		TERM: "dumb",
		LANG: process.env.LANG ?? "en_US.UTF-8",
		HOME: home,
		SHELL: process.env.SHELL ?? "/bin/zsh",
		USER: process.env.USER,
		LOGNAME: process.env.LOGNAME,
		TMPDIR: process.env.TMPDIR,
		HTTPS_PROXY: proxyUrl,
		https_proxy: proxyUrl,
		NO_PROXY: "localhost,127.0.0.1",
		NODE_EXTRA_CA_CERTS: join(certs, "ca.crt"),
		CI: "1",
		...command.env,
	};
	console.log(`start ${runId}`);
	const proc = await runProcess(command.cmd, command.args, {
		cwd: workdir,
		env,
		stdoutFile: join(scratch, "agent.stdout"),
		stderrFile: join(scratch, "agent.stderr"),
		timeout: timeoutMs,
	});
	proxy.child.kill();
	const result = {
		runId,
		task: task.id,
		agent,
		model: modelKey,
		gatewayId: model.gatewayId,
		rep,
		startedAt: new Date(Date.now() - proc.wallMs).toISOString(),
		...proc,
		...grade(task, workdir, runDir),
		agentVersion: sh(command.cmd, ["--version"], workdir).trim().split("\n")[0],
		agentConfig: command.config,
	};
	const stdout = readFileSync(join(scratch, "agent.stdout"), "utf8");
	writeFileSync(join(runDir, "agent-output.tail.txt"), stdout.slice(-20_000));
	writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));
	console.log(
		`done ${runId} pass=${result.passed} wall=${Math.round(proc.wallMs / 1000)}s code=${proc.code}${proc.timedOut ? " TIMEOUT" : ""}`,
	);
}

const queue = [];
for (let rep = 1; rep <= Number(opts.reps); rep++) {
	for (const task of tasks) {
		for (const modelKey of modelKeys) {
			for (const agent of agents) {
				queue.push({ task, agent, modelKey, rep });
			}
		}
	}
}
mkdirSync(resultsRoot, { recursive: true });
const usageBefore = await keyUsage();
await Promise.all(
	Array.from({ length: Number(opts.concurrency) }, async () => {
		while (queue.length) {
			const stop = await budgetStop(usageBefore);
			if (stop) {
				console.log(`stopping before ${queue.length} queued runs: ${stop}`);
				queue.length = 0;
				break;
			}
			const job = queue.shift();
			try {
				await runOne(job);
			} catch (err) {
				console.error(
					`failed ${job.task.id} ${job.agent} ${job.modelKey}: ${err.stack ?? err}`,
				);
			}
		}
	}),
);
await new Promise((r) => setTimeout(r, 30_000));
const usageAfter = await keyUsage();
const ledgerFile = join(resultsRoot, "key-usage.jsonl");
writeFileSync(
	ledgerFile,
	(existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "") +
		JSON.stringify({
			at: new Date().toISOString(),
			usageBefore,
			usageAfter,
			agents,
			models: modelKeys,
			tasks: tasks.map((t) => t.id),
			reps: Number(opts.reps),
		}) +
		"\n",
);
console.log(`key usage: ${usageBefore} -> ${usageAfter}`);
