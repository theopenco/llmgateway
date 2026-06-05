module.exports = {
	apps: [
		{
			name: "gateway",
			script: "./apps/gateway/dist/serve.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "4001",
			},
		},
		{
			name: "api",
			script: "./apps/api/dist/serve.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "4002",
			},
		},
		{
			name: "ui",
			script: "./apps/ui/.next/standalone/apps/ui/server.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "3002",
				HOSTNAME: "0.0.0.0",
			},
		},
		{
			name: "playground",
			script: "./apps/playground/.next/standalone/apps/playground/server.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "3003",
				HOSTNAME: "0.0.0.0",
			},
		},
		{
			name: "code",
			script: "./apps/code/.next/standalone/apps/code/server.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "3004",
				HOSTNAME: "0.0.0.0",
			},
		},
		{
			name: "docs",
			script: "./apps/docs/.next/standalone/apps/docs/server.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "3005",
				HOSTNAME: "0.0.0.0",
			},
		},
		{
			name: "admin",
			script: "./ee/admin/.next/standalone/ee/admin/server.js",
			cwd: "/root/llmgateway",
			node_args: "--env-file=.env",
			env: {
				NODE_ENV: "production",
				PORT: "3006",
				HOSTNAME: "0.0.0.0",
			},
		},
	],
};
