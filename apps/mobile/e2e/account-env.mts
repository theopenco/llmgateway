import process from "node:process";
import { mock } from "node:test";

import * as email from "../../api/dist/utils/email.js";

const api = new URL(process.env.API_URL ?? "http://invalid");
if (
	!process.env.STACK_SUFFIX ||
	!process.env.GATEWAY_PORT ||
	api.hostname !== "localhost" ||
	api.port !== process.env.API_PORT
) {
	throw new Error("Load an isolated localhost stack for account fixtures.");
}
process.env.HOSTED = "true";
for (const name of Object.keys(process.env)) {
	if (name.startsWith("RESEND_") || name.startsWith("DISCORD_")) {
		Reflect.deleteProperty(process.env, name);
	}
}
// The imported email module may have already initialized its shared client.
mock.module("@llmgateway/shared/email", {
	namedExports: {
		fromEmail: "Lounge fixture <fixture@example.test>",
		replyToEmail: "fixture@example.test",
		resendAudienceId: "",
		getResendClient: () => null,
	},
});
mock.module(new URL("../../api/dist/utils/email.js", import.meta.url), {
	namedExports: {
		...email,
		sendTransactionalEmail: async (
			message: email.TransactionalEmailOptions,
		) => {
			const response = await fetch(
				`http://localhost:${Number(process.env.GATEWAY_PORT) + 8}/fixture-accounts/mail`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(message),
				},
			);
			if (!response.ok) {
				throw new Error("Local account email delivery failed.");
			}
		},
	},
});
