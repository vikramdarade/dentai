/**
 * Clinical Audio Silence Policy & Adaptive Sleep Engine.
 *
 * Enforces continuous listening safety guidelines:
 * - 3-minute silence sleep (180s) to prevent battery drain and accidental post-op recording.
 * - 30-second warning countdown (at 150s) with double-pip 784 Hz chime.
 * - Pure decision function with zero side-effects, fully unit-testable.
 */

export const SILENCE_WARN_SECONDS = 150;
export const SILENCE_SLEEP_SECONDS = 180;
export const SILENCE_WARN_CHIME_HZ = 784;

export type SilenceAction = 'none' | 'warn' | 'pause';

/**
 * Pure function to decide the audio capture state based on elapsed silence duration.
 * Boundary definitions:
 * - silenceSeconds >= 180: 'pause'
 * - silenceSeconds >= 150 and < 180: 'warn'
 * - silenceSeconds < 150: 'none'
 */
export function decideSilenceAction(silenceSeconds: number): SilenceAction {
  if (silenceSeconds >= SILENCE_SLEEP_SECONDS) {
    return 'pause';
  }
  if (silenceSeconds >= SILENCE_WARN_SECONDS) {
    return 'warn';
  }
  return 'none';
}
