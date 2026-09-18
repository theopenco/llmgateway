import { AudioContext } from "react-native-audio-api";

import {
	computeRms,
	pcm16Base64ToFloat,
	REALTIME_SAMPLE_RATE,
	rmsToLevel,
} from "@llmgateway/shared/realtime-pcm";

import type { AudioBufferSourceNode } from "react-native-audio-api";

export interface PlaybackCut {
	itemId: string;
	contentIndex: number;
	playedMs: number;
}
export interface VoicePlayback {
	resume: () => Promise<void>;
	enqueue: (
		itemId: string,
		contentIndex: number,
		audio: string,
		sampleRate?: number,
	) => void;
	flush: () => PlaybackCut[];
	getLevel: () => number;
	isPlaying: boolean;
	close: () => Promise<void>;
}
interface ScheduledChunk {
	source: AudioBufferSourceNode;
	start: number;
	duration: number;
}
interface PlaybackItem {
	contentIndex: number;
	completedSeconds: number;
	chunks: Set<ScheduledChunk>;
}

export class NativeRealtimePlayback implements VoicePlayback {
	private readonly analyser;
	private readonly samples = new Float32Array(1024);
	private items = new Map<string, PlaybackItem>();
	private nextStart = 0;
	private lastItem: string | undefined;
	private closing?: Promise<void>;
	public constructor(
		private readonly context = new AudioContext({
			sampleRate: REALTIME_SAMPLE_RATE,
		}),
	) {
		this.analyser = context.createAnalyser();
		this.analyser.fftSize = this.samples.length;
		this.analyser.smoothingTimeConstant = 0.6;
		this.analyser.connect(context.destination);
	}
	public resume() {
		return this.context.resume();
	}
	public get isPlaying() {
		return [...this.items.values()].some((item) => item.chunks.size > 0);
	}
	public getLevel() {
		if (!this.isPlaying) {
			return 0;
		}
		this.analyser.getFloatTimeDomainData(this.samples);
		return rmsToLevel(computeRms(this.samples));
	}
	public enqueue(
		itemId: string,
		contentIndex: number,
		audio: string,
		sampleRate = REALTIME_SAMPLE_RATE,
	) {
		if (this.closing) {
			return;
		}
		const samples = pcm16Base64ToFloat(audio);
		if (!samples.length) {
			return;
		}
		for (const [id, item] of this.items) {
			if (id !== itemId && item.chunks.size === 0) {
				this.items.delete(id);
			}
		}
		this.lastItem = itemId;
		let item = this.items.get(itemId);
		if (!item) {
			item = { contentIndex, completedSeconds: 0, chunks: new Set() };
			this.items.set(itemId, item);
		}
		const buffer = this.context.createBuffer(1, samples.length, sampleRate);
		buffer.copyToChannel(new Float32Array(samples), 0);
		const source = this.context.createBufferSource();
		source.buffer = buffer;
		source.connect(this.analyser);
		const chunk = {
			source,
			start: Math.max(this.nextStart, this.context.currentTime),
			duration: buffer.duration,
		};
		item.chunks.add(chunk);
		const owner = item;
		source.onEnded = () => {
			owner.chunks.delete(chunk);
			owner.completedSeconds += chunk.duration;
			source.onEnded = null;
			source.disconnect();
			if (!owner.chunks.size && this.lastItem !== itemId) {
				this.items.delete(itemId);
			}
		};
		source.start(chunk.start);
		this.nextStart = chunk.start + chunk.duration;
	}
	public flush(): PlaybackCut[] {
		const items = this.items;
		this.items = new Map();
		this.nextStart = 0;
		this.lastItem = undefined;
		const now = this.context.currentTime;
		const cuts: PlaybackCut[] = [];
		const failures: unknown[] = [];
		for (const [itemId, item] of items) {
			let seconds = item.completedSeconds;
			for (const chunk of item.chunks) {
				seconds += Math.min(chunk.duration, Math.max(0, now - chunk.start));
				chunk.source.onEnded = null;
				try {
					chunk.source.stop();
				} catch (error) {
					failures.push(error);
				}
				try {
					chunk.source.disconnect();
				} catch (error) {
					failures.push(error);
				}
			}
			cuts.push({
				itemId,
				contentIndex: item.contentIndex,
				playedMs: Math.round(seconds * 1000),
			});
		}
		if (failures.length) {
			throw new AggregateError(failures, "Could not stop voice playback.");
		}
		return cuts;
	}
	public close() {
		this.closing ??= (async () => {
			try {
				this.flush();
			} finally {
				await this.context.close();
			}
		})();
		return this.closing;
	}
}
