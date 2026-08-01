/* eslint-disable no-mixed-operators -- canvas layout math is dense with
 * mixed arithmetic, and prettier strips the clarifying parentheses the rule
 * would otherwise require (same trade-off as packages/db/src/logs.ts). */
import { formatPassportDate as formatDate } from "./passport-data";

import type {
	PassportAirline,
	PassportAirport,
	PassportModel,
	PassportStampData,
} from "./passport-data";

/**
 * Every passport face is drawn into an offscreen 2D canvas and mounted as a
 * three.js CanvasTexture — pages are "printed" from live profile data, which
 * a pre-modelled asset could never show.
 */

export const PAGE_W = 768;
export const PAGE_H = 1092;

const PAPER = "#f2ecdd";
const PAPER_INK = "#3d3a2f";
const PAPER_FAINT = "rgba(61,58,47,0.38)";
const GUILLOCHE = "rgba(96,116,160,0.14)";
const COVER_BG = "#141d38";
const COVER_GOLD = "#c9a227";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "ui-sans-serif, system-ui, -apple-system, sans-serif";

const TIER_INK: Record<string, string> = {
	lite: "#3f6212",
	pro: "#3730a3",
	max: "#92400e",
};

function makeCanvas(): CanvasRenderingContext2D {
	const canvas = document.createElement("canvas");
	canvas.width = PAGE_W;
	canvas.height = PAGE_H;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("2d canvas unavailable");
	}
	return ctx;
}

/**
 * Ellipsize `text` so it fits `maxWidth` with the CURRENT ctx.font — set the
 * font before calling. Keeps user-provided strings (names, handles, model
 * ids) from spilling over adjacent fields or the page edge.
 */
function fitText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string {
	if (ctx.measureText(text).width <= maxWidth) {
		return text;
	}
	let trimmed = text;
	while (
		trimmed.length > 1 &&
		ctx.measureText(trimmed + "…").width > maxWidth
	) {
		trimmed = trimmed.slice(0, -1);
	}
	return trimmed + "…";
}

function formatCompact(n: number): string {
	return new Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(n);
}

/** Cream paper with faint guilloche waves and a hairline frame. */
function drawPaper(ctx: CanvasRenderingContext2D): void {
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, PAGE_W, PAGE_H);

	ctx.save();
	ctx.strokeStyle = GUILLOCHE;
	ctx.lineWidth = 1.4;
	for (let i = 0; i < 26; i++) {
		ctx.beginPath();
		for (let x = -40; x <= PAGE_W + 40; x += 8) {
			const y =
				90 + i * 38 + Math.sin(x / 68 + i * 1.7) * 14 + Math.sin(x / 23) * 4;
			if (x === -40) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}
		ctx.stroke();
	}
	ctx.restore();

	ctx.strokeStyle = PAPER_FAINT;
	ctx.lineWidth = 2;
	ctx.strokeRect(26, 26, PAGE_W - 52, PAGE_H - 52);
}

function pageHeader(ctx: CanvasRenderingContext2D, title: string): void {
	ctx.fillStyle = PAPER_INK;
	ctx.font = `600 30px ${MONO}`;
	ctx.textAlign = "center";
	ctx.letterSpacing = "10px";
	ctx.fillText(title, PAGE_W / 2, 92);
	ctx.letterSpacing = "0px";
	ctx.strokeStyle = PAPER_FAINT;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(80, 118);
	ctx.lineTo(PAGE_W - 80, 118);
	ctx.stroke();
}

function emptyNotice(ctx: CanvasRenderingContext2D, text: string): void {
	ctx.fillStyle = PAPER_FAINT;
	ctx.font = `500 26px ${MONO}`;
	ctx.textAlign = "center";
	ctx.letterSpacing = "6px";
	ctx.fillText(text, PAGE_W / 2, PAGE_H / 2);
	ctx.letterSpacing = "0px";
}

function drawEmblem(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	r: number,
	color: string,
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = Math.max(2.5, r * 0.045);
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
	ctx.stroke();
	// Latitude/longitude grid inside the ring — the "globe".
	ctx.lineWidth = Math.max(1.6, r * 0.028);
	for (const f of [-0.55, 0, 0.55]) {
		const squeeze = Math.sqrt(1 - f * f);
		ctx.beginPath();
		ctx.ellipse(x, y, r * 0.62 * squeeze, r * 0.62, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.ellipse(
			x,
			y + f * r * 0.62,
			r * 0.62 * squeeze,
			r * 0.2,
			0,
			0,
			Math.PI * 2,
		);
		ctx.stroke();
	}
	// Code brackets flanking the globe.
	ctx.font = `700 ${Math.round(r * 0.62)}px ${MONO}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText("<", x - r * 1.42, y);
	ctx.fillText(">", x + r * 1.42, y);
	ctx.restore();
}

export function drawCoverOuter(): HTMLCanvasElement {
	const ctx = makeCanvas();
	ctx.fillStyle = COVER_BG;
	ctx.fillRect(0, 0, PAGE_W, PAGE_H);

	// Leather grain: deterministic speckle.
	ctx.fillStyle = "rgba(255,255,255,0.02)";
	for (let i = 0; i < 2600; i++) {
		const x = (Math.sin(i * 12.9898) * 0.5 + 0.5) * PAGE_W;
		const y = (Math.sin(i * 78.233) * 0.5 + 0.5) * PAGE_H;
		ctx.fillRect(x, y, 2, 2);
	}

	ctx.strokeStyle = COVER_GOLD;
	ctx.lineWidth = 3;
	ctx.strokeRect(40, 40, PAGE_W - 80, PAGE_H - 80);

	ctx.fillStyle = COVER_GOLD;
	ctx.textAlign = "center";
	ctx.font = `600 44px ${MONO}`;
	ctx.letterSpacing = "18px";
	ctx.fillText("DEVPASS", PAGE_W / 2, 220);
	ctx.letterSpacing = "0px";

	drawEmblem(ctx, PAGE_W / 2, PAGE_H / 2 - 30, 130, COVER_GOLD);

	ctx.font = `600 58px ${MONO}`;
	ctx.letterSpacing = "22px";
	ctx.fillText("PASSPORT", PAGE_W / 2, PAGE_H - 260);
	ctx.letterSpacing = "0px";
	ctx.font = `500 24px ${MONO}`;
	ctx.letterSpacing = "8px";
	ctx.fillStyle = "rgba(201,162,39,0.75)";
	ctx.fillText("LLM GATEWAY", PAGE_W / 2, PAGE_H - 190);
	ctx.letterSpacing = "0px";
	return ctx.canvas;
}

export function drawCoverInner(): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	drawEmblem(ctx, PAGE_W / 2, PAGE_H / 2 - 40, 150, "rgba(61,58,47,0.12)");
	ctx.fillStyle = PAPER_FAINT;
	ctx.textAlign = "center";
	ctx.font = `500 22px ${MONO}`;
	ctx.letterSpacing = "3px";
	ctx.fillText("This passport records the bearer's", PAGE_W / 2, PAGE_H - 220);
	ctx.fillText("AI coding travels on DevPass.", PAGE_W / 2, PAGE_H - 184);
	ctx.letterSpacing = "0px";
	return ctx.canvas;
}

export function drawVisaPage(data: PassportModel): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	pageHeader(ctx, "VISA");

	ctx.textAlign = "left";

	// Holder block.
	const label = (text: string, x: number, y: number) => {
		ctx.fillStyle = PAPER_FAINT;
		ctx.font = `500 18px ${MONO}`;
		ctx.letterSpacing = "3px";
		ctx.fillText(text, x, y);
		ctx.letterSpacing = "0px";
	};
	const value = (
		text: string,
		x: number,
		y: number,
		size = 30,
		maxWidth = PAGE_W - 140,
	) => {
		ctx.fillStyle = PAPER_INK;
		ctx.font = `600 ${size}px ${SANS}`;
		ctx.fillText(fitText(ctx, text, maxWidth), x, y);
	};

	label("SURNAME / GIVEN NAMES", 70, 180);
	value(data.holderName.toUpperCase(), 70, 218);
	label("CALLSIGN", 70, 280);
	// The member-since column starts at x=400; keep the callsign clear of it.
	value(data.username ? `@${data.username}` : "—", 70, 318, 30, 310);
	label("MEMBER SINCE", 400, 280);
	value(formatDate(data.memberSince), 400, 318, 26);

	// Visa sticker.
	const vx = 70;
	const vy = 380;
	const vw = PAGE_W - 140;
	const vh = 430;
	if (data.visa) {
		const ink = TIER_INK[data.visa.tier] ?? PAPER_INK;
		ctx.save();
		ctx.fillStyle = "rgba(255,255,255,0.55)";
		ctx.fillRect(vx, vy, vw, vh);
		ctx.strokeStyle = ink;
		ctx.lineWidth = 3;
		ctx.strokeRect(vx, vy, vw, vh);
		ctx.strokeRect(vx + 8, vy + 8, vw - 16, vh - 16);

		const stickerMidX = vx + vw / 2;
		ctx.fillStyle = ink;
		ctx.textAlign = "center";
		ctx.font = `600 26px ${MONO}`;
		ctx.letterSpacing = "8px";
		ctx.fillText("DEVPASS VISA", stickerMidX, vy + 58);
		ctx.letterSpacing = "0px";

		ctx.font = `700 92px ${MONO}`;
		ctx.fillText(data.visa.tier.toUpperCase(), stickerMidX, vy + 176);

		ctx.textAlign = "left";
		label("VALID FROM", vx + 40, vy + 250);
		value(formatDate(data.visa.startedAt), vx + 40, vy + 288, 28);
		label("DATE OF EXPIRY", stickerMidX + 20, vy + 250);
		value(formatDate(data.visa.expiresAt), stickerMidX + 20, vy + 288, 28);

		label("ENTRIES", vx + 40, vy + 344);
		value("MULTIPLE", vx + 40, vy + 380, 26);
		label("STATUS", stickerMidX + 20, vy + 344);
		value("ACTIVE", stickerMidX + 20, vy + 380, 26);

		// Round duty seal overlapping the sticker corner.
		ctx.globalAlpha = 0.8;
		ctx.translate(vx + vw - 74, vy + vh - 60);
		ctx.rotate(-0.28);
		ctx.strokeStyle = ink;
		ctx.lineWidth = 3.5;
		ctx.beginPath();
		ctx.arc(0, 0, 62, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(0, 0, 50, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = ink;
		ctx.textAlign = "center";
		ctx.font = `700 20px ${MONO}`;
		ctx.fillText("DEVPASS", 0, -6);
		ctx.font = `600 15px ${MONO}`;
		ctx.fillText("IMMIGRATION", 0, 16);
		ctx.restore();
	} else {
		ctx.save();
		ctx.setLineDash([12, 10]);
		ctx.strokeStyle = PAPER_FAINT;
		ctx.lineWidth = 3;
		ctx.strokeRect(vx, vy, vw, vh);
		ctx.setLineDash([]);
		const emptyMidX = vx + vw / 2;
		const emptyMidY = vy + vh / 2;
		ctx.fillStyle = PAPER_FAINT;
		ctx.textAlign = "center";
		ctx.font = `600 30px ${MONO}`;
		ctx.letterSpacing = "6px";
		ctx.fillText("NO ACTIVE VISA", emptyMidX, emptyMidY - 14);
		ctx.font = `500 22px ${MONO}`;
		ctx.letterSpacing = "2px";
		ctx.fillText("APPLY AT DEVPASS.LLMGATEWAY.IO", emptyMidX, emptyMidY + 34);
		ctx.letterSpacing = "0px";
		ctx.restore();
	}

	// Machine-readable zone.
	ctx.fillStyle = PAPER_INK;
	ctx.textAlign = "left";
	ctx.font = `600 26px ${MONO}`;
	ctx.letterSpacing = "4px";
	const tier = data.visa?.tier.toUpperCase() ?? "NONE";
	const callsign = (data.username ?? "TRAVELLER")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
	const mrz1 = `P<DEVPASS<<${callsign}`.padEnd(34, "<").slice(0, 34);
	const mrz2 = `${tier}<VISA<MULTIPLE<ENTRIES`.padEnd(34, "<").slice(0, 34);
	ctx.fillText(mrz1, 58, PAGE_H - 120);
	ctx.fillText(mrz2, 58, PAGE_H - 78);
	ctx.letterSpacing = "0px";
	return ctx.canvas;
}

export function drawAirportsPage(
	airports: PassportAirport[],
): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	pageHeader(ctx, "PORTS OF ENTRY");

	ctx.fillStyle = PAPER_FAINT;
	ctx.textAlign = "center";
	ctx.font = `500 20px ${MONO}`;
	ctx.letterSpacing = "5px";
	ctx.fillText("MODEL FAMILIES VISITED", PAGE_W / 2, 156);
	ctx.letterSpacing = "0px";

	if (airports.length === 0) {
		emptyNotice(ctx, "NO PORTS VISITED");
		return ctx.canvas;
	}

	const rows = airports.slice(0, 7);
	const top = 220;
	const rowH = 108;
	rows.forEach((airport, i) => {
		const y = top + i * rowH;
		ctx.strokeStyle = PAPER_FAINT;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(64, y + 70);
		ctx.lineTo(PAGE_W - 64, y + 70);
		ctx.stroke();

		// Airport code plate.
		ctx.fillStyle = PAPER_INK;
		ctx.textAlign = "left";
		ctx.font = `700 52px ${MONO}`;
		ctx.fillText(airport.code, 72, y + 52);

		ctx.font = `500 27px ${SANS}`;
		ctx.fillText(fitText(ctx, airport.label, 300), 240, y + 44);

		ctx.textAlign = "right";
		ctx.font = `600 24px ${MONO}`;
		ctx.fillText(
			`${formatCompact(airport.requestCount)} REQ`,
			PAGE_W - 72,
			y + 46,
		);
	});
	return ctx.canvas;
}

export function drawAirlinesPage(
	airlines: PassportAirline[],
): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	pageHeader(ctx, "CARRIERS");

	ctx.fillStyle = PAPER_FAINT;
	ctx.textAlign = "center";
	ctx.font = `500 20px ${MONO}`;
	ctx.letterSpacing = "5px";
	ctx.fillText("HARNESSES FLOWN", PAGE_W / 2, 156);
	ctx.letterSpacing = "0px";

	if (airlines.length === 0) {
		emptyNotice(ctx, "NO CARRIERS ON RECORD");
		return ctx.canvas;
	}

	const rows = airlines.slice(0, 6);
	const top = 224;
	const rowH = 128;
	rows.forEach((airline, i) => {
		const y = top + i * rowH;
		ctx.fillStyle = "rgba(255,255,255,0.5)";
		ctx.fillRect(64, y, PAGE_W - 128, 100);
		ctx.strokeStyle = PAPER_FAINT;
		ctx.lineWidth = 1.5;
		ctx.strokeRect(64, y, PAGE_W - 128, 100);

		// Winged mark.
		ctx.strokeStyle = PAPER_INK;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(96, y + 56);
		ctx.quadraticCurveTo(122, y + 26, 150, y + 50);
		ctx.moveTo(96, y + 56);
		ctx.quadraticCurveTo(122, y + 44, 150, y + 62);
		ctx.stroke();

		ctx.fillStyle = PAPER_INK;
		ctx.textAlign = "left";
		ctx.font = `600 30px ${SANS}`;
		ctx.fillText(fitText(ctx, airline.label, 360), 180, y + 46);
		ctx.fillStyle = PAPER_FAINT;
		ctx.font = `500 20px ${MONO}`;
		ctx.fillText(
			`${formatCompact(airline.totalTokens)} TOKENS CARRIED`,
			180,
			y + 78,
		);

		ctx.fillStyle = PAPER_INK;
		ctx.textAlign = "right";
		ctx.font = `600 24px ${MONO}`;
		ctx.fillText(
			`${formatCompact(airline.requestCount)} FLT`,
			PAGE_W - 90,
			y + 58,
		);
	});
	return ctx.canvas;
}

const STAMP_INKS = ["#166534", "#3730a3", "#9f1239", "#92400e"];

export function drawStampsPage(
	stamps: PassportStampData[],
	pageIndex: number,
): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	pageHeader(ctx, pageIndex === 0 ? "ENTRIES · EXITS" : "ENTRIES · EXITS II");

	if (stamps.length === 0) {
		emptyNotice(
			ctx,
			pageIndex === 0 ? "AWAITING FIRST ENTRY" : "MORE TRAVELS AHEAD",
		);
		return ctx.canvas;
	}

	stamps.forEach((stamp, i) => {
		const cx = PAGE_W / 2 + (i % 2 === 0 ? -74 : 88) + Math.sin(i * 7.3) * 26;
		const cy = 300 + i * 260 + Math.sin(i * 3.1) * 18;
		const rot =
			(i % 2 === 0 ? -1 : 1) * (0.09 + 0.05 * Math.abs(Math.sin(i * 5)));
		const ink = STAMP_INKS[(i + pageIndex) % STAMP_INKS.length];
		const w = 460;
		const h = 196;

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(rot);
		const left = -w / 2;
		const top = -h / 2;
		ctx.globalAlpha = 0.86;
		ctx.strokeStyle = ink;
		ctx.fillStyle = ink;
		ctx.lineWidth = 4;
		ctx.strokeRect(left, top, w, h);
		ctx.lineWidth = 1.8;
		ctx.strokeRect(left + 7, top + 7, w - 14, h - 14);

		ctx.textAlign = "center";
		ctx.font = `500 17px ${MONO}`;
		ctx.letterSpacing = "4px";
		ctx.fillText(fitText(ctx, stamp.family.toUpperCase(), w - 60), 0, top + 38);
		ctx.letterSpacing = "0px";

		ctx.font = `700 30px ${MONO}`;
		ctx.fillText(fitText(ctx, stamp.model.toUpperCase(), w - 50), 0, top + 78);

		ctx.font = `600 19px ${MONO}`;
		ctx.textAlign = "left";
		ctx.fillText(`ENTRY  ${formatDate(stamp.entry)}`, left + 30, -top - 58);
		ctx.fillText(`EXIT   ${formatDate(stamp.exit)}`, left + 30, -top - 28);
		ctx.textAlign = "right";
		ctx.font = `700 26px ${MONO}`;
		ctx.fillText(formatCompact(stamp.requestCount), -left - 30, -top - 40);
		ctx.font = `500 14px ${MONO}`;
		ctx.fillText("REQUESTS", -left - 30, -top - 20);
		ctx.restore();
	});
	return ctx.canvas;
}

export function drawEndorsementsPage(data: PassportModel): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	pageHeader(ctx, "ENDORSEMENTS");

	ctx.fillStyle = PAPER_INK;
	ctx.textAlign = "center";
	ctx.font = `600 34px ${MONO}`;
	ctx.fillText(
		`${formatCompact(data.totalRequests)} REQUESTS`,
		PAGE_W / 2,
		300,
	);
	ctx.fillText(`${data.activeDays} ACTIVE DAYS`, PAGE_W / 2, 360);

	drawEmblem(ctx, PAGE_W / 2, 620, 110, "rgba(61,58,47,0.25)");

	// Barcode strip.
	ctx.fillStyle = PAPER_INK;
	for (let i = 0; i < 60; i++) {
		const wBar = 3 + Math.floor((Math.sin(i * 9.7) * 0.5 + 0.5) * 8);
		const x = 120 + i * 9;
		if (x + wBar > PAGE_W - 120) {
			break;
		}
		ctx.fillRect(x, PAGE_H - 260, wBar, 90);
	}

	ctx.fillStyle = PAPER_FAINT;
	ctx.font = `500 22px ${MONO}`;
	ctx.letterSpacing = "3px";
	ctx.fillText(
		fitText(
			ctx,
			data.username
				? `DEVPASS.LLMGATEWAY.IO/PROFILES/${data.username.toUpperCase()}`
				: "DEVPASS.LLMGATEWAY.IO",
			PAGE_W - 120,
		),
		PAGE_W / 2,
		PAGE_H - 120,
	);
	ctx.letterSpacing = "0px";
	return ctx.canvas;
}

export function drawBackCoverInner(): HTMLCanvasElement {
	const ctx = makeCanvas();
	drawPaper(ctx);
	drawEmblem(ctx, PAGE_W / 2, PAGE_H / 2, 130, "rgba(61,58,47,0.1)");
	return ctx.canvas;
}

export function drawBackCoverOuter(): HTMLCanvasElement {
	const ctx = makeCanvas();
	ctx.fillStyle = COVER_BG;
	ctx.fillRect(0, 0, PAGE_W, PAGE_H);
	ctx.strokeStyle = "rgba(201,162,39,0.5)";
	ctx.lineWidth = 3;
	ctx.strokeRect(40, 40, PAGE_W - 80, PAGE_H - 80);
	drawEmblem(ctx, PAGE_W / 2, PAGE_H / 2, 90, "rgba(201,162,39,0.35)");
	return ctx.canvas;
}
