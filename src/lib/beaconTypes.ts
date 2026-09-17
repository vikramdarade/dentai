export type BeaconStatus = 'idle' | 'recording' | 'paused' | 'uploading' | 'completed';

export interface ChairPairingSession {
  chairId: string;
  pinCode: string;
  roomName: string;
  clinicId?: string;
  dentistId?: string;
  dentistName?: string;
  createdAt: number;
  expiresAt: number;
  token: string;
  status: 'waiting' | 'paired' | 'active' | 'generating';
  deviceInfo?: {
    model: string;
    batteryLevel?: number;
    isCharging?: boolean;
    userAgent: string;
  };
}

export type BeaconAction =
  | 'start_recording'
  | 'stop_recording'
  | 'pause_recording'
  | 'resume_recording'
  | 'cancel'
  | 'dismissal_cue_detected'
  | 'inactivity_warning'
  | 'ping';

export interface BeaconCommandMessage {
  id: string;
  chairId: string;
  action: BeaconAction;
  timestamp: number;
  payload?: any;
}

export interface BeaconDeviceTelemetry {
  chairId: string;
  status: BeaconStatus;
  batteryLevel?: number;
  isCharging?: boolean;
  audioLevel?: number; // 0.0 - 1.0
  bufferedChunksCount: number;
  recordingSeconds: number;
  dismissalDetected?: {
    phrase: string;
    confidence: number;
    detectedAt: number;
  };
  inactivitySeconds?: number;
  lastHeartbeat: number;
}

export interface DismissalDetectionResult {
  detected: boolean;
  phrase?: string;
  confidence: number;
  detectedAt?: number;
}
