export interface Note {
  pitch: string; // e.g., "C4", "Eb3"
  duration: string; // e.g., "4n", "8n", "2n"
  time: string; // Transport time or relative tick
  velocity: number; // 0 to 1
  detune?: number; // Pitch shift in cents (-100 to 100)
  groupId?: string;
}

export type MusicStyle = 'Classical' | 'Jazz' | 'Cyberpunk' | 'Lo-Fi' | 'Ambient' | 'Minimalist';
export type VisualMode = 'studio' | 'neural' | 'classic';

export interface Composition {
  id: string;
  name: string;
  style: MusicStyle;
  notes: Note[];
  tempo: number;
  createdAt: number;
}
