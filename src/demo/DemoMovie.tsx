/**
 * Narrated demo player — the in-app "video" at #/demo.
 *
 * A time-based timeline (exactly like a video player) advances through the
 * scenes defined in demoScript.ts. Each scene's narration is spoken with the
 * browser's speech synthesis while the captions show the same text, so the
 * player can be screen-recorded into an MP4 with narration baked in
 * (see docs/demo/README.md for the recording workflow).
 *
 * Zero backend: this screen never touches /api, so it works in any preview.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  MonitorPlay,
  Maximize,
  Minimize,
  X,
  Sparkles,
  Mic,
  Building2,
} from 'lucide-react';
import SceneStage from './Scenes';
import {
  DEMO_SCENES,
  DEMO_TOTAL_MS,
  sceneIndexAt,
  sceneProgressAt,
  formatClock,
  type DemoAct,
} from './demoScript';

const ACTS: { id: DemoAct; label: string }[] = [
  { id: 'intro', label: 'Intro' },
  { id: 'dentist', label: 'For Dentists' },
  { id: 'owner', label: 'For Owners' },
];

const ACT_ICONS: Record<DemoAct, React.ReactNode> = {
  intro: <Sparkles className="w-3.5 h-3.5" />,
  dentist: <Mic className="w-3.5 h-3.5" />,
  owner: <Building2 className="w-3.5 h-3.5" />,
};

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (en.length === 0) return null;
  return (
    en.find((v) => /en[-_]au/i.test(v.lang)) ||
    en.find((v) => /en[-_]gb/i.test(v.lang)) ||
    en.find((v) => /en[-_]us/i.test(v.lang)) ||
    en[0]
  );
}

interface DemoMovieProps {
  onExit: () => void;
}

export default function DemoMovie({ onExit }: DemoMovieProps) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [narration, setNarration] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [present, setPresent] = useState(false);
  const [ended, setEnded] = useState(false);

  const elapsedRef = useRef(0);
  const playingRef = useRef(false);
  const narrationRef = useRef(true);
  const speedRef = useRef(1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Cache a good English voice (voices load asynchronously).
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => {
      voiceRef.current = pickVoice(synth.getVoices());
    };
    load();
    synth.addEventListener('voiceschanged', load);
    return () => {
      synth.removeEventListener('voiceschanged', load);
      synth.cancel();
    };
  }, []);

  const speakScene = useCallback((sceneIdx: number) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    if (!narrationRef.current) return;
    const scene = DEMO_SCENES[sceneIdx];
    if (!scene) return;
    const u = new SpeechSynthesisUtterance(scene.tts ?? scene.narration);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = Math.min(2, speedRef.current * 0.95);
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
  }, []);

  // Timeline clock — advances while playing (speed-scaled).
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (playingRef.current) {
        const next = elapsedRef.current + dt * speedRef.current;
        if (next >= DEMO_TOTAL_MS) {
          elapsedRef.current = DEMO_TOTAL_MS;
          setElapsed(DEMO_TOTAL_MS);
          playingRef.current = false;
          setPlaying(false);
          setEnded(true);
          window.speechSynthesis?.cancel();
          return;
        }
        elapsedRef.current = next;
        setElapsed(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Speak when the on-screen scene changes (only while actively playing — the
  // Play button is the user gesture that unlocks speech synthesis).
  const sceneIdx = sceneIndexAt(elapsed);
  const lastSceneRef = useRef(-1);
  useEffect(() => {
    if (sceneIdx !== lastSceneRef.current && playingRef.current) {
      lastSceneRef.current = sceneIdx;
      speakScene(sceneIdx);
    }
  }, [sceneIdx, speakScene]);

  const seekTo = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(DEMO_TOTAL_MS, ms));
      const wasPlaying = playingRef.current;
      playingRef.current = false;
      setPlaying(false);
      setEnded(false);
      elapsedRef.current = clamped;
      setElapsed(clamped);
      window.speechSynthesis?.cancel();
      if (wasPlaying) {
        // Restore playback at the target scene with its narration.
        playingRef.current = true;
        setPlaying(true);
        lastSceneRef.current = -2; // force scene-change effect
        setElapsed(clamped - 0.001);
      }
    },
    []
  );

  const togglePlay = useCallback(() => {
    const synth = window.speechSynthesis;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      synth?.cancel();
    } else {
      if (elapsedRef.current >= DEMO_TOTAL_MS) {
        elapsedRef.current = 0;
        setElapsed(0);
        setEnded(false);
        lastSceneRef.current = -2;
      }
      playingRef.current = true;
      setPlaying(true);
      setEnded(false);
      speakScene(sceneIndexAt(elapsedRef.current));
    }
  }, [speakScene]);

  const restart = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setEnded(false);
    elapsedRef.current = 0;
    setElapsed(0);
    lastSceneRef.current = -2;
    window.speechSynthesis?.cancel();
  }, []);

  const goToScene = useCallback(
    (delta: number) => {
      const idx = sceneIndexAt(elapsedRef.current);
      const target = Math.max(0, Math.min(DEMO_SCENES.length - 1, idx + delta));
      const start = target === 0 ? 0 : DEMO_SCENES.slice(0, target).reduce((a, s) => a + s.duration, 0);
      const wasPlaying = playingRef.current;
      playingRef.current = false;
      setPlaying(false);
      window.speechSynthesis?.cancel();
      elapsedRef.current = start;
      setElapsed(start);
      setEnded(false);
      lastSceneRef.current = -2;
      if (wasPlaying) {
        playingRef.current = true;
        setPlaying(true);
        speakScene(target);
      }
    },
    [speakScene]
  );

  const toggleNarration = useCallback(() => {
    const next = !narrationRef.current;
    narrationRef.current = next;
    setNarration(next);
    if (!next) {
      window.speechSynthesis?.cancel();
    } else if (playingRef.current) {
      speakScene(sceneIndexAt(elapsedRef.current));
    }
  }, [speakScene]);

  const togglePresent = useCallback(() => setPresent((p) => !p), []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const scene = DEMO_SCENES[sceneIdx];
  const progress = sceneProgressAt(elapsed);
  const activeAct: DemoAct = scene.act;
  const firstOfAct = (act: DemoAct) => DEMO_SCENES.findIndex((s) => s.act === act);

  return (
    <div className="h-screen w-full bg-[#0B1220] text-white flex flex-col overflow-hidden font-sans">
      {/* Top chrome (hidden in present mode) */}
      {!present && (
        <header className="shrink-0 flex items-center justify-between px-4 md:px-6 h-14 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onExit}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors text-xs font-semibold cursor-pointer"
            >
              <X className="w-4 h-4" /> Exit demo
            </button>
            <div className="w-px h-5 bg-white/15" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shadow-md shadow-primary/30 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold leading-tight truncate">DentAI</span>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-tight">
                  Narrated product demo
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-1 bg-white/5 border border-white/10 rounded-full px-1 py-1">
              {ACTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => seekTo(DEMO_SCENES.slice(0, firstOfAct(a.id)).reduce((acc, s) => acc + s.duration, 0))}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                    activeAct === a.id ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {ACT_ICONS[a.id]}
                  {a.label}
                </button>
              ))}
            </div>
            <button
              onClick={toggleNarration}
              title={narration ? 'Narration on' : 'Narration off'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                narration ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              {narration ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{narration ? 'Narration' : 'Muted'}</span>
            </button>
            <select
              value={speed}
              onChange={(e) => {
                const s = Number(e.target.value);
                speedRef.current = s;
                setSpeed(s);
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 outline-none cursor-pointer"
              title="Playback speed"
            >
              <option value={0.75} className="bg-slate-900">0.75×</option>
              <option value={1} className="bg-slate-900">1×</option>
              <option value={1.25} className="bg-slate-900">1.25×</option>
              <option value={1.5} className="bg-slate-900">1.5×</option>
            </select>
            <button
              onClick={togglePresent}
              title="Present / record mode — hides all controls"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                present ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              <MonitorPlay className="w-4 h-4" />
              <span className="hidden sm:inline">Record</span>
            </button>
          </div>
        </header>
      )}

      {/* Stage */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-3 md:px-6 py-3">
        <div
          ref={stageRef}
          className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white ring-1 ring-white/15 shadow-2xl shadow-black/40"
          style={{ height: 'clamp(440px, 66vh, 680px)' }}
        >
          <SceneStage scene={scene} progress={progress} />

          {/* In-demo act badge (hidden in present mode) */}
          {!present && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/70 backdrop-blur text-[10px] font-bold uppercase tracking-widest text-slate-200">
              {ACT_ICONS[scene.act]}
              {scene.act === 'dentist' ? 'Dentist' : scene.act === 'owner' ? 'Owner' : 'Intro'} · {sceneIdx + 1} /{' '}
              {DEMO_SCENES.length}
            </div>
          )}

          {/* Start overlay */}
          {!playing && !ended && elapsed === 0 && (
            <div className="absolute inset-0 z-20 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center">
              <button
                onClick={togglePlay}
                className="flex flex-col items-center gap-3 group cursor-pointer"
              >
                <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-2xl shadow-primary/40 group-hover:scale-105 transition-transform">
                  <Play className="w-8 h-8 text-white ml-1" fill="currentColor" />
                </div>
                <span className="text-sm font-bold text-white bg-slate-900/60 px-4 py-1.5 rounded-full">
                  Play narrated demo · {formatClock(DEMO_TOTAL_MS)}
                </span>
              </button>
            </div>
          )}

          {/* Replay overlay */}
          {ended && (
            <div className="absolute inset-0 z-20 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center">
              <button onClick={restart} className="flex flex-col items-center gap-3 group cursor-pointer">
                <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center shadow-2xl shadow-primary/40 group-hover:scale-105 transition-transform">
                  <RotateCcw className="w-8 h-8 text-white" />
                </div>
                <span className="text-sm font-bold text-white bg-slate-900/60 px-4 py-1.5 rounded-full">Replay demo</span>
              </button>
            </div>
          )}
        </div>

        {/* Captions */}
        <div className="w-full max-w-5xl mt-3 px-1">
          <div className="flex items-start gap-3">
            <div className="hidden md:flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-300 mt-0.5">
              <Sparkles className="w-3 h-3 text-primary" />
              {scene.title}
            </div>
            <p className="text-sm md:text-[15px] leading-relaxed text-slate-200">
              {scene.narration}
            </p>
          </div>
        </div>
      </div>

      {/* Controls (hidden in present mode) */}
      {!present && (
        <footer className="shrink-0 border-t border-white/10 px-4 md:px-6 py-3 bg-[#0E1626]">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-105 transition-transform cursor-pointer"
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <Pause className="w-5 h-5 text-white" fill="currentColor" />
                ) : (
                  <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />
                )}
              </button>
              <button
                onClick={restart}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Restart"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => goToScene(-1)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Previous scene"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <input
                type="range"
                min={0}
                max={DEMO_TOTAL_MS}
                value={elapsed}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="flex-1 h-1.5 cursor-pointer"
                style={{ accentColor: '#0F52BA' }}
                aria-label="Seek"
              />

              <button
                onClick={() => goToScene(1)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Next scene"
              >
                <SkipForward className="w-4 h-4" />
              </button>
              <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                {formatClock(elapsed)} / {formatClock(DEMO_TOTAL_MS)}
              </span>
              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">
                {scene.title}
              </span>
              <button
                onClick={togglePresent}
                className="text-[10px] text-slate-400 hover:text-white font-bold uppercase tracking-widest cursor-pointer"
              >
                Present / record mode →
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Present-mode escape hatch */}
      {present && (
        <button
          onClick={togglePresent}
          className="absolute bottom-4 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/80 border border-white/15 text-slate-200 text-[11px] font-bold hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <MonitorPlay className="w-3.5 h-3.5" /> Exit record mode
        </button>
      )}
    </div>
  );
}