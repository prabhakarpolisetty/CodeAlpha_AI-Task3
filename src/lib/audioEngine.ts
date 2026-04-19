import * as Tone from 'tone';
import { Note } from '../types';

class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private part: Tone.Part | null = null;
  private reverb: Tone.Reverb | null = null;
  private delay: Tone.FeedbackDelay | null = null;

  async init() {
    await Tone.start();
    
    this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.3 }).toDestination();
    this.delay = new Tone.FeedbackDelay("8n", 0.3).toDestination();
    
    this.synth = new Tone.PolySynth(Tone.Synth).connect(this.reverb).connect(this.delay);
    this.setInstrument('Neuro-Synth');
  }

  setInstrument(type: string) {
    if (!this.synth) return;
    
    let options: any = {};
    switch (type) {
      case 'FM-Piano':
        this.synth.set({
          oscillator: { type: "fmtriangle" as any },
          envelope: { attack: 0.005, decay: 1.2, sustain: 0.1, release: 1 }
        });
        break;
      case 'Neuro-Synth':
        this.synth.set({
          oscillator: { type: "triangle" },
          envelope: { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.8 }
        });
        break;
      case 'Atmos-Pad':
        this.synth.set({
          oscillator: { type: "sine" },
          envelope: { attack: 1.5, decay: 0.5, sustain: 0.8, release: 4 }
        });
        break;
      case 'Deep-Bass':
        this.synth.set({
          oscillator: { type: "fatsawtooth" as any },
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.2 }
        });
        break;
      case 'Lo-Fi':
        this.synth.set({
          oscillator: { type: "pulse" },
          envelope: { attack: 0.1, decay: 0.4, sustain: 0.2, release: 1.2 }
        });
        break;
      case 'Strings':
        this.synth.set({
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.4, decay: 0.2, sustain: 0.6, release: 1.5 }
        });
        break;
      default:
        this.synth.set({
          oscillator: { type: "triangle" },
          envelope: { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.8 }
        });
    }
  }

  setTempo(bpm: number) {
    Tone.Transport.bpm.value = bpm;
  }

  setTimeSignature(numerator: number, denominator: number = 4) {
    Tone.Transport.timeSignature = numerator;
  }

  setReverb(wet: number) {
    if (this.reverb) {
      this.reverb.wet.value = wet;
    }
  }

  setDelay(wet: number, feedback: number = 0.3) {
    if (this.delay) {
      this.delay.wet.value = wet;
      this.delay.feedback.value = feedback;
    }
  }

  playSequence(notes: Note[], onNoteActive?: (index: number) => void) {
    this.stop();
    
    this.part = new Tone.Part((time, note: Note) => {
      const freq = Tone.Frequency(note.pitch).toFrequency() * Math.pow(2, (note.detune || 0) / 1200);
      this.synth?.triggerAttackRelease(freq, note.duration, time, note.velocity);
      
      if (onNoteActive) {
        Tone.Draw.schedule(() => {
          // Find index of this note in the original array
          const index = notes.findIndex(n => n.time === note.time && n.pitch === note.pitch);
          if (index !== -1) onNoteActive(index);
        }, time);
      }
    }, notes.map(n => [n.time, n]));

    this.part.start(0);
    Tone.Transport.start();
  }

  playNotePreview(note: Note) {
    if (!this.synth) return;
    const freq = Tone.Frequency(note.pitch).toFrequency() * Math.pow(2, (note.detune || 0) / 1200);
    this.synth.triggerAttackRelease(freq, "8n", undefined, note.velocity * 0.5);
  }

  stop() {
    this.part?.dispose();
    Tone.Transport.stop();
    Tone.Transport.cancel();
  }

  get isPlaying() {
    return Tone.Transport.state === 'started';
  }

  getCurrentPosition() {
    return Tone.Transport.position;
  }

  triggerAttack(pitch: string, velocity: number) {
    if (!this.synth) return;
    this.synth.triggerAttack(pitch, undefined, velocity);
  }

  triggerRelease(pitch: string) {
    if (!this.synth) return;
    this.synth.triggerRelease(pitch);
  }

  startTransport() {
    Tone.Transport.start();
  }

  stopTransport() {
    Tone.Transport.stop();
  }
}

export const audioEngine = new AudioEngine();
