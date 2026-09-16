/**
 * Operatory Real-Time Streaming Speech Client
 * Streams 16kHz linear PCM audio through browser AudioWorklet + Web Audio DSP filter chain
 * to DentAI's Google Cloud Speech streaming gateway with parallel IndexedDB fallback buffering.
 */

import { createOperatoryAudioStream, FilteredAudioSession } from './operatoryAudioFilter';
import { saveAudioChunk } from './beaconAudioStorage';

export interface DentalEntityBadge {
  id: string;
  category: 'tooth' | 'surface' | 'ada_code' | 'diagnosis';
  value: string;
  label: string;
  timestampMs: number;
}

export interface StreamingSpeechClientCallbacks {
  onInterim?: (text: string, stability: number) => void;
  onFinal?: (text: string, confidence: number) => void;
  onEntityDetected?: (entity: DentalEntityBadge) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'connected' | 'recording' | 'paused' | 'error') => void;
}

export class StreamingSpeechClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private filterSession: FilteredAudioSession | null = null;
  private callbacks: StreamingSpeechClientCallbacks;
  private consultationId: string;
  private authToken: string | null;
  private chunkIndex = 0;
  private frameSeq = 0;
  private unackedRingBuffer: { seq: number; buffer: ArrayBuffer }[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private maxReconnectAttempts = 8;
  private isRecording = false;
  private isPaused = false;
  private status: 'idle' | 'connecting' | 'connected' | 'recording' | 'paused' | 'error' = 'idle';

  constructor(consultationId: string, authToken?: string | null, callbacks: StreamingSpeechClientCallbacks = {}) {
    this.consultationId = consultationId;
    this.authToken = authToken || null;
    this.callbacks = callbacks;
  }

  public getStatus() {
    return this.status;
  }

  private setStatus(status: 'idle' | 'connecting' | 'connected' | 'recording' | 'paused' | 'error') {
    this.status = status;
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(status);
    }
  }

  /**
   * Starts the audio pipeline and connects WebSocket stream.
   */
  public async start(): Promise<void> {
    if (this.isRecording) return;
    this.setStatus('connecting');

    try {
      // 1. Establish WebSocket Connection
      await this.connectWebSocket();

      // 2. Request Operatory Microphone with browser AEC and noise suppression
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // We use our specialized operatory DSP filter
          autoGainControl: true,
          channelCount: 1
        }
      });

      // 3. Connect through Operatory DSP Filter (drill notch + mask speech boost + compressor)
      this.filterSession = createOperatoryAudioStream(this.mediaStream);
      this.audioContext = this.filterSession.audioContext;

      if (!this.audioContext) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtxClass();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 4. Load & Attach AudioWorklet PCM Processor
      try {
        await this.audioContext.audioWorklet.addModule('/audio-processors/pcmAudioProcessor.js');
      } catch (err) {
        console.warn('[StreamingSpeechClient] AudioWorklet load warning (may be already loaded):', err);
      }

      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-audio-processor');

      // 5. Connect DSP stream output into AudioWorklet
      const filterSource = this.audioContext.createMediaStreamSource(this.filterSession.filteredStream);
      filterSource.connect(this.workletNode);

      // Handle binary PCM frames from AudioWorklet
      this.workletNode.port.onmessage = (event) => {
        if (event.data && event.data.type === 'AUDIO_FRAME' && event.data.buffer) {
          const buffer = event.data.buffer;
          this.handleAudioFrame(buffer);
        }
      };

      this.isRecording = true;
      this.isPaused = false;
      this.setStatus('recording');

      // Send start_session control frame
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'start_session',
          sampleRate: 16000,
          languageCode: 'en-AU'
        }));
      }

    } catch (err: any) {
      console.error('[StreamingSpeechClient] Failed to start speech pipeline:', err);
      this.setStatus('error');
      if (this.callbacks.onError) {
        this.callbacks.onError(err.message || 'Microphone or WebSocket connection failed.');
      }
      this.stop();
      throw err;
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const tokenParam = this.authToken ? `token=${encodeURIComponent(this.authToken)}&` : '';
      const wsUrl = `${protocol}//${host}/api/ws/speech-stream?${tokenParam}consultationId=${encodeURIComponent(this.consultationId)}`;

      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          this.ws.close();
          reject(new Error('WebSocket connection timed out'));
        }
      }, 7000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.setStatus('connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.warn('[StreamingSpeechClient] Unparsed WS message:', event.data);
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(timeout);
        console.error('[StreamingSpeechClient] WS Error:', err);
        if (this.callbacks.onError) {
          this.callbacks.onError('WebSocket error connecting to Google Cloud speech stream.');
        }
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        if (this.isRecording && !this.isPaused) {
          console.warn('[StreamingSpeechClient] WS closed while recording. Attempting auto-reconnection...');
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect() {
    if (!this.isRecording || this.isPaused || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.setStatus('error');
        if (this.callbacks.onError) {
          this.callbacks.onError('Surgery Wi-Fi disconnect threshold reached. Local audio buffer preserved.');
        }
      }
      return;
    }

    this.setStatus('connecting');
    const delay = Math.min(500 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 200, 4000);
    this.reconnectAttempts++;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connectWebSocket();
        this.reconnectAttempts = 0;
        this.setStatus('recording');

        // Flush unacknowledged ring buffer burst over newly opened stream
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'start_session',
            sampleRate: 16000,
            languageCode: 'en-AU',
            isReconnection: true
          }));

          const burstQueue = [...this.unackedRingBuffer];
          for (const item of burstQueue) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(item.buffer);
            }
          }
        }
      } catch (err) {
        console.warn('[StreamingSpeechClient] Reconnection attempt failed, retrying...', err);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private handleAudioFrame(pcmArrayBuffer: ArrayBuffer) {
    if (!this.isRecording || this.isPaused) return;

    // 1. Maintain in-memory ring buffer for burst replay (last ~10 seconds of 16kHz PCM)
    this.unackedRingBuffer.push({ seq: this.frameSeq++, buffer: pcmArrayBuffer });
    if (this.unackedRingBuffer.length > 320) {
      this.unackedRingBuffer.shift();
    }

    // 2. Stream over WebSocket to Google Cloud STT
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcmArrayBuffer);
    }

    // 3. Parallel Zero-Loss IndexedDB Audio Chunk Persistence
    try {
      const blob = new Blob([pcmArrayBuffer], { type: 'audio/pcm' });
      saveAudioChunk(this.consultationId, this.chunkIndex++, blob).catch(() => {
        // Non-blocking background save
      });
    } catch {}
  }

  private handleServerMessage(msg: any) {
    switch (msg.type) {
      case 'interim_transcript':
        if (this.callbacks.onInterim) {
          this.callbacks.onInterim(msg.text, msg.stability);
        }
        break;

      case 'final_transcript':
        if (this.callbacks.onFinal) {
          this.callbacks.onFinal(msg.text, msg.confidence);
        }
        break;

      case 'dental_entity_detected':
        if (this.callbacks.onEntityDetected) {
          this.callbacks.onEntityDetected({
            id: `entity_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            category: msg.category,
            value: msg.value,
            label: msg.label,
            timestampMs: msg.timestampMs || Date.now()
          });
        }
        break;

      case 'error':
        if (this.callbacks.onError) {
          this.callbacks.onError(msg.message || 'Speech stream error');
        }
        break;

      default:
        break;
    }
  }

  public pause(): void {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    this.setStatus('paused');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ command: 'SET_MUTE', muted: true });
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pause_session' }));
    }
  }

  public resume(): void {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    this.setStatus('recording');
    if (this.workletNode) {
      this.workletNode.port.postMessage({ command: 'SET_MUTE', muted: false });
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resume_session' }));
    }
  }

  public stop(): void {
    this.isRecording = false;
    this.isPaused = false;
    this.setStatus('idle');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop_session' }));
      this.ws.close();
    }
    this.ws = null;

    if (this.filterSession) {
      this.filterSession.close();
      this.filterSession = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.workletNode = null;
  }
}
