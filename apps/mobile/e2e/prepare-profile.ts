import assert from "node:assert/strict";

async function prepareProfile() {
	const base = new URL(process.env.LOUNGE_API_URL ?? "http://localhost:4902");
	assert(
		["localhost", "127.0.0.1"].includes(base.hostname),
		"Use the isolated local API",
	);
	const response = await fetch(new URL("/auth/sign-in/email", base), {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: base.origin },
		body: JSON.stringify({
			email: "admin@example.com",
			password: "admin@example.com",
		}),
	});
	assert.equal(response.status, 200, "Seeded account sign-in failed");
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const reset = await fetch(new URL("/user/me", base), {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Origin: base.origin,
			Cookie: cookie,
		},
		body: JSON.stringify({
			profilePublic: false,
			username: null,
			profileHidePicture: false,
		}),
	});
	assert.equal(reset.status, 200, "Could not reset the seeded profile");
	process.stdout.write(
		"Seeded profile is private and ready for the username flow.\n",
	);
}

void prepareProfile().catch((error: unknown) => {
	process.stderr.write(`${String(error)}\n`);
	process.exitCode = 1;
});
