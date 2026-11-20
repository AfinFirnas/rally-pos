// ============================================================================
// WEB AUDIO API HARDWARE SYNTHESIZER (ZERO EXTERNAL AUDIO FILES)
// ============================================================================

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

class SoundFeedbackEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private masterVolume = 0.65;

  isAudioSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as WindowWithWebkitAudio;
    return Boolean(window.AudioContext || win.webkitAudioContext);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  getMuted(): boolean {
    return this.muted;
  }

  setMasterVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Ensures a running AudioContext, safely resuming if suspended by browser autoplay rules.
   * Call during any button tap or camera-scan interaction.
   */
  async unlockAudioContext(): Promise<AudioContext | null> {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const win = window as WindowWithWebkitAudio;
      const AudioCtor = window.AudioContext ?? win.webkitAudioContext;
      if (!AudioCtor) return null;
      this.ctx = new AudioCtor();
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return this.ctx;
      }
    }

    return this.ctx;
  }

  private triggerVibration(pattern: number | number[]): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Ignore on devices/browsers disallowing vibration
      }
    }
  }

  private scheduleTone(
    ctx: AudioContext,
    options: {
      frequencyHz: number;
      endFrequencyHz?: number;
      startTime: number;
      durationSec: number;
      waveform: OscillatorType;
      peakGain: number;
      lowPassHz?: number;
    }
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const effectivePeak = Math.max(0.001, options.peakGain * this.masterVolume);

    osc.type = options.waveform;
    osc.frequency.setValueAtTime(options.frequencyHz, options.startTime);
    if (options.endFrequencyHz !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        options.endFrequencyHz,
        options.startTime + options.durationSec
      );
    }

    // Smooth ADSR-like envelope prevents clicking/popping
    const attackEnd = options.startTime + Math.min(0.015, options.durationSec * 0.2);
    const stopTime = options.startTime + options.durationSec;

    gain.gain.setValueAtTime(0.0001, options.startTime);
    gain.gain.linearRampToValueAtTime(effectivePeak, attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    if (options.lowPassHz !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(options.lowPassHz, options.startTime);
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }

    gain.connect(ctx.destination);
    osc.start(options.startTime);
    osc.stop(stopTime + 0.01);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Ascending two-tone chime (C6 1046.5Hz -> E6 1318.5Hz) paired with a crisp haptic pulse
   * for valid POS checkout completion.
   */
  async playSuccessChime(withHaptics = true): Promise<void> {
    if (withHaptics) {
      this.triggerVibration(45);
    }
    if (this.muted) return;

    const ctx = await this.unlockAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime + 0.005;

    // Tone 1: C6 (1046.50 Hz) + soft triangle overtone
    this.scheduleTone(ctx, {
      frequencyHz: 1046.5,
      startTime: now,
      durationSec: 0.13,
      waveform: 'sine',
      peakGain: 0.42,
    });
    this.scheduleTone(ctx, {
      frequencyHz: 1046.5,
      startTime: now,
      durationSec: 0.11,
      waveform: 'triangle',
      peakGain: 0.12,
    });

    // Tone 2: E6 (1318.51 Hz) ascending bell ring
    this.scheduleTone(ctx, {
      frequencyHz: 1318.51,
      startTime: now + 0.105,
      durationSec: 0.24,
      waveform: 'sine',
      peakGain: 0.48,
    });
    this.scheduleTone(ctx, {
      frequencyHz: 1318.51,
      startTime: now + 0.105,
      durationSec: 0.2,
      waveform: 'triangle',
      peakGain: 0.14,
    });
  }

  /**
   * Low double-buzz error/cooldown tone (160Hz -> 130Hz low-pass filtered sawtooth pulses)
   * paired with double haptic buzz to alert the cashier immediately.
   */
  async playErrorTone(withHaptics = true): Promise<void> {
    if (withHaptics) {
      this.triggerVibration([75, 55, 115]);
    }
    if (this.muted) return;

    const ctx = await this.unlockAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime + 0.005;

    // Buzz 1: 165 Hz -> 145 Hz
    this.scheduleTone(ctx, {
      frequencyHz: 165,
      endFrequencyHz: 145,
      startTime: now,
      durationSec: 0.13,
      waveform: 'sawtooth',
      peakGain: 0.36,
      lowPassHz: 620,
    });

    // Buzz 2: 145 Hz -> 115 Hz after a 65ms gap
    this.scheduleTone(ctx, {
      frequencyHz: 145,
      endFrequencyHz: 115,
      startTime: now + 0.195,
      durationSec: 0.18,
      waveform: 'sawtooth',
      peakGain: 0.42,
      lowPassHz: 560,
    });
  }

  /** Semantic alias for cooldown violation feedback. */
  async playCooldownBuzz(withHaptics = true): Promise<void> {
    return this.playErrorTone(withHaptics);
  }

  /**
   * Celebratory 4-note ascending arpeggio (C6 -> E6 -> G6 -> C7) when a sale hits
   * an Hourly Hidden Bounty booth.
   */
  async playBountyFanfare(withHaptics = true): Promise<void> {
    if (withHaptics) {
      this.triggerVibration([40, 35, 40, 35, 90]);
    }
    if (this.muted) return;

    const ctx = await this.unlockAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime + 0.005;
    const notes = [1046.5, 1318.51, 1567.98, 2093.0];

    notes.forEach((freq, idx) => {
      const isLast = idx === notes.length - 1;
      this.scheduleTone(ctx, {
        frequencyHz: freq,
        startTime: now + idx * 0.085,
        durationSec: isLast ? 0.32 : 0.14,
        waveform: 'triangle',
        peakGain: isLast ? 0.45 : 0.32,
        lowPassHz: 4200,
      });
    });
  }

  /**
   * Subtle 20ms tactile click for POS quick-tap item & numpad buttons.
   */
  async playTapTick(): Promise<void> {
    if (this.muted) return;
    const ctx = await this.unlockAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    this.scheduleTone(ctx, {
      frequencyHz: 780,
      endFrequencyHz: 420,
      startTime: now,
      durationSec: 0.025,
      waveform: 'sine',
      peakGain: 0.14,
    });
  }
}

export const soundFeedback = new SoundFeedbackEngine();