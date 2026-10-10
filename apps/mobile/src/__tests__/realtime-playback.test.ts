import { AudioContext } from "react-native-audio-api";

import { NativeRealtimePlayback } from "@/lib/realtime-playback";

import { floatToPcm16Base64 } from "@llmgateway/shared/realtime-pcm";

jest.mock("react-native-audio-api", () => ({ AudioContext: jest.fn() }));

function harness() {
	const nodes: {
		start: jest.Mock;
		stop: jest.Mock;
		disconnect: jest.Mock;
		connect: jest.Mock;
		onEnded: (() => void) | null;
		buffer: unknown;
	}[] = [];
	const analyser = {
		fftSize: 0,
		smoothingTimeConstant: 0,
		connect: jest.fn(),
		getFloatTimeDomainData: jest.fn((samples: Float32Array) =>
			samples.fill(0.1),
		),
	};
	const context = {
		currentTime: 0,
		destination: {},
		resume: jest.fn().mockResolvedValue(undefined),
		close: jest.fn().mockResolvedValue(undefined),
		createAnalyser: () => analyser,
		createBuffer: jest.fn(
			(_channels: number, length: number, rate: number) => ({
				duration: length / rate,
				copyToChannel: jest.fn(),
			}),
		),
		createBufferSource: () => {
			const node = {
				start: jest.fn(),
				stop: jest.fn(),
				disconnect: jest.fn(),
				connect: jest.fn(),
				onEnded: null as (() => void) | null,
				buffer: undefined,
			};
			nodes.push(node);
			return node;
		},
	};
	jest.mocked(AudioContext).mockReturnValue(context as unknown as AudioContext);
	return { playback: new NativeRealtimePlayback(), nodes, context };
}
const second = floatToPcm16Base64(new Float32Array(24000).fill(0.1));

test("queues chunks contiguously and truncates each item to audio actually heard", () => {
	const h = harness();
	h.playback.enqueue("one", 0, second);
	h.playback.enqueue("one", 0, second);
	h.playback.enqueue("two", 1, second);
	expect(h.nodes.map((node) => node.start.mock.calls[0][0])).toEqual([0, 1, 2]);
	h.context.currentTime = 1.25;
	h.nodes[0].onEnded?.();
	expect(h.playback.flush()).toEqual([
		{ itemId: "one", contentIndex: 0, playedMs: 1250 },
		{ itemId: "two", contentIndex: 1, playedMs: 0 },
	]);
	expect(h.nodes[0].stop).not.toHaveBeenCalled();
	expect(h.nodes[1].stop).toHaveBeenCalledTimes(1);
	expect(h.nodes[2].stop).toHaveBeenCalledTimes(1);
	expect(h.playback.isPlaying).toBe(false);
	expect(h.playback.getLevel()).toBe(0);
});

test("does not count network gaps as heard speech", () => {
	const h = harness();
	h.playback.enqueue("one", 0, second);
	h.context.currentTime = 1;
	h.nodes[0].onEnded?.();
	h.context.currentTime = 4;
	h.playback.enqueue("one", 0, second);
	h.context.currentTime = 4.5;
	expect(h.playback.flush()).toEqual([
		{ itemId: "one", contentIndex: 0, playedMs: 1500 },
	]);
});

test("honors source sample rates and releases the context even if a source cannot stop", async () => {
	const h = harness();
	h.playback.enqueue("one", 0, second, 16000);
	h.playback.enqueue("two", 0, second);
	expect(h.nodes[1].start).toHaveBeenCalledWith(1.5);
	h.nodes[0].stop.mockImplementation(() => {
		throw new Error("Native failure");
	});
	await expect(h.playback.close()).rejects.toThrow(
		"Could not stop voice playback",
	);
	expect(h.context.close).toHaveBeenCalledTimes(1);
	expect(h.nodes[1].disconnect).toHaveBeenCalledTimes(1);
	expect(h.nodes.every((node) => node.onEnded === null)).toBe(true);
	h.playback.enqueue("late", 0, second);
	expect(h.nodes).toHaveLength(2);
});
