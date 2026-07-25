/**
 * AudioWorklet processor that batches mono Float32 microphone samples and
 * posts them to the main thread roughly every 2048 samples (~43ms at 48kHz).
 * Resampling and PCM16 conversion happen on the main thread so this stays a
 * tight copy loop on the audio thread.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this._chunks = [];
		this._samples = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (channel && channel.length > 0) {
			this._chunks.push(new Float32Array(channel));
			this._samples += channel.length;
			if (this._samples >= 2048) {
				const merged = new Float32Array(this._samples);
				let offset = 0;
				for (const chunk of this._chunks) {
					merged.set(chunk, offset);
					offset += chunk.length;
				}
				this.port.postMessage(merged, [merged.buffer]);
				this._chunks = [];
				this._samples = 0;
			}
		}
		return true;
	}
}

registerProcessor("pcm-recorder", PcmRecorderProcessor);
