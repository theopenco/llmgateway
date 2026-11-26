import { describe, expect, test } from "vitest";

import {
	dayBarClass,
	formatIncidentDuration,
	formatUptime,
	incidentImpactByDay,
	type OfficialIncident,
} from "./provider-status";

function incident(overrides: Partial<OfficialIncident>): OfficialIncident {
	return {
		id: "inc",
		name: "Incident",
		status: "resolved",
		impact: "minor",
		createdAt: "2026-11-01T10:00:00.000Z",
		resolvedAt: "2026-11-01T11:30:00.000Z",
		url: "https://status.example.com/incidents/inc",
		...overrides,
	};
}

describe("incidentImpactByDay", () => {
	test("marks every UTC day an incident spans with its worst impact", () => {
		const byDay = incidentImpactByDay([
			incident({
				id: "a",
				impact: "minor",
				createdAt: "2026-11-01T22:00:00.000Z",
				resolvedAt: "2026-11-02T02:00:00.000Z",
			}),
			incident({
				id: "b",
				impact: "critical",
				createdAt: "2026-11-02T05:00:00.000Z",
				resolvedAt: "2026-11-02T06:00:00.000Z",
			}),
		]);

		expect(Object.fromEntries(byDay)).toEqual({
			"2026-11-01": "minor",
			"2026-11-02": "critical",
		});
	});

	test("extends unresolved incidents to now and skips no-impact ones", () => {
		const byDay = incidentImpactByDay(
			[
				incident({
					impact: "major",
					createdAt: "2026-11-05T23:00:00.000Z",
					resolvedAt: null,
				}),
				incident({ id: "quiet", impact: "none" }),
			],
			new Date("2026-11-06T08:00:00.000Z"),
		);

		expect(Object.fromEntries(byDay)).toEqual({
			"2026-11-05": "major",
			"2026-11-06": "major",
		});
	});

	test("ignores incidents with invalid dates", () => {
		expect(
			incidentImpactByDay([
				incident({ createdAt: "garbage" }),
				incident({
					createdAt: "2026-11-02T00:00:00.000Z",
					resolvedAt: "2026-11-01T00:00:00.000Z",
				}),
			]).size,
		).toBe(0);
	});
});

describe("formatIncidentDuration", () => {
	test.each([
		["2026-11-01T10:00:00.000Z", "2026-11-01T10:45:00.000Z", "45 min"],
		["2026-11-01T10:00:00.000Z", "2026-11-01T12:00:00.000Z", "2 h"],
		["2026-11-01T10:00:00.000Z", "2026-11-01T11:30:00.000Z", "1 h 30 min"],
		["2026-11-01T10:00:00.000Z", null, null],
		["2026-11-01T10:00:00.000Z", "2026-11-01T09:00:00.000Z", null],
	])("%s → %s", (createdAt, resolvedAt, expected) => {
		expect(formatIncidentDuration(incident({ createdAt, resolvedAt }))).toBe(
			expected,
		);
	});
});

describe("day bars", () => {
	test("needs enough traffic before colouring a day", () => {
		expect(
			dayBarClass({
				date: "2026-11-01",
				requestCount: 5,
				errorsCount: 0,
				uptime: 100,
			}),
		).toBe("bg-muted");
		expect(
			dayBarClass({
				date: "2026-11-01",
				requestCount: 500,
				errorsCount: 50,
				uptime: 90,
			}),
		).toBe("bg-orange-500");
	});

	test("formats uptime without rounding outages up to 100%", () => {
		expect(formatUptime(100)).toBe("100%");
		expect(formatUptime(99.994)).toBe("99.99%");
		expect(formatUptime(97.5)).toBe("97.50%");
	});
});
