import { NextResponse } from "next/server";

export function GET() {
	return NextResponse.json({
		status: "ok",
		sha: process.env.APP_VERSION ?? null,
	});
}
