/**
 * Operatory PCM AudioWorklet Processor
 * Runs on a dedicated browser audio rendering thread.
 * Downsamples native browser audio (44.1kHz / 48kHz) to 16,000 Hz linear PCM16.
 * Buffers samples into ~100ms frames (1,600 samples = 3,200 bytes) for real-time WebSocket streaming.
 */

class PcmAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    // 100ms at 16kHz = 1,600 samples
    this.frameSize = 1600;
    this.pcmBuffer = new Int16Array(this.frameSize);
    this.pcmIndex = 0;
    this.isMuted = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.command === 'SET_MUTE') {
        this.isMuted = !!event.data.muted;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || this.isMuted) {
      return true;
    }

    const channelData = input[0];
    const sourceSampleRate = sampleRate; // Global in AudioWorkletGlobalScope

    if (sourceSampleRate === this.targetSampleRate) {
      for (let i = 0; i < channelData.length; i++) {
        this.pushSample(channelData[i]);
      }
    } else {
      // Linear interpolation downsampler to 16kHz
      const ratio = sourceSampleRate / this.targetSampleRate;
      let targetIndex = 0;
      while (true) {
        const sourceIndex = targetIndex * ratio;
        const i0 = Math.floor(sourceIndex);
        const i1 = Math.min(i0 + 1, channelData.length - 1);
        if (i0 >= channelData.length) break;

        const fraction = sourceIndex - i0;
        const sample = channelData[i0] + (channelData[i1] - channelData[i0]) * fraction;
        this.pushSample(sample);
        targetIndex++;
      }
    }

    return true;
  }

  pushSample(floatSample) {
    // Clamp to [-1.0, 1.0] and quantize to 16-bit signed integer [-32768, 32767]
    const clamped = Math.max(-1.0, Math.min(1.0, floatSample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.pcmBuffer[this.pcmIndex++] = int16;

    if (this.pcmIndex >= this.frameSize) {
      // Transfer Int16 buffer to main thread for network transmission
      const frame = new Int16Array(this.pcmBuffer);
      this.port.postMessage({
        type: 'AUDIO_FRAME',
        buffer: frame.buffer
      }, [frame.buffer]);

      this.pcmIndex = 0;
      this.pcmBuffer = new Int16Array(this.frameSize);
    }
  }
}

registerProcessor('pcm-audio-processor', PcmAudioProcessor);
