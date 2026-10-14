import { describe, expect, it } from "vitest";

import { RealtimeDurationMeter } from "./duration-meter.js";

const pcm = (seconds: number, bytesPerSecond = 48_000) =>
	Buffer.alloc(Math.round(seconds * bytesPerSecond)).toString("base64");

describe("RealtimeDurationMeter", () => {
	it("bills the increase of a running total", () => {
		const meter = new RealtimeDurationMeter();
		// Observed live: three audio turns report 3, 6 and 10; text turns
		// after them report 10 again.
		expect(meter.increase(3)).toBe(3);
		meter.commit(3, 0);
		expect(meter.increase(6)).toBe(3);
		meter.commit(6, 0);
		expect(meter.increase(10)).toBe(4);
		meter.commit(10, 0);
		expect(meter.increase(10)).toBe(0);
		expect(meter.increase(8)).toBe(0);
	});

	it("reports nothing unreported before the meter starts", () => {
		expect(new RealtimeDurationMeter().unreportedSeconds(60_000)).toBe(0);
	});

	it("counts whole seconds since start or the last report", () => {
		const meter = new RealtimeDurationMeter();
		meter.start(1_000);
		expect(meter.unreportedSeconds(13_900)).toBe(12);
		meter.commit(12, 14_000);
		expect(meter.unreportedSeconds(14_999)).toBe(0);
		expect(meter.unreportedSeconds(21_000)).toBe(7);
	});

	it("counts input audio sent faster than real time", () => {
		const meter = new RealtimeDurationMeter();
		meter.addInputAudio(pcm(14.2), 1_000);
		expect(meter.unreportedSeconds(2_000)).toBe(14);
		meter.commit(14, 2_000);
		expect(meter.unreportedSeconds(2_000)).toBe(0);
	});

	it("derives the audio rate from the session's input format", () => {
		const meter = new RealtimeDurationMeter();
		meter.setInputFormat({ type: "audio/pcmu" });
		meter.addInputAudio(pcm(5, 8_000), 0);
		expect(meter.unreportedSeconds(0)).toBe(5);

		const pcm16k = new RealtimeDurationMeter();
		pcm16k.setInputFormat({ type: "audio/pcm", rate: 16_000 });
		pcm16k.addInputAudio(pcm(5, 32_000), 0);
		expect(pcm16k.unreportedSeconds(0)).toBe(5);

		const legacy = new RealtimeDurationMeter();
		legacy.setInputFormat("g711_alaw");
		legacy.addInputAudio(pcm(2, 8_000), 0);
		expect(legacy.unreportedSeconds(0)).toBe(2);
	});

	it("falls back to elapsed time for opus input", () => {
		const meter = new RealtimeDurationMeter();
		meter.setInputFormat({ type: "audio/opus" });
		meter.addInputAudio(pcm(30), 0);
		expect(meter.unreportedSeconds(4_000)).toBe(4);
	});
});
