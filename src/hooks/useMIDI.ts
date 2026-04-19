import { useState, useEffect, useCallback } from 'react';

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiNoteToPitch = (note: number): string => {
  const octave = Math.floor(note / 12) - 1;
  const name = noteNames[note % 12];
  return `${name}${octave}`;
};

export const useMIDI = (onNoteOn?: (note: number, velocity: number) => void, onNoteOff?: (note: number) => void) => {
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [access, setAccess] = useState<MIDIAccess | null>(null);

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser');
      return;
    }

    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        setAccess(midiAccess);
        const updateInputs = () => {
          setInputs(Array.from(midiAccess.inputs.values()));
        };
        updateInputs();
        midiAccess.onstatechange = updateInputs;
      },
      (err) => console.error('Could not access MIDI devices', err)
    );
  }, []);

  const handleMIDIMessage = useCallback((event: any) => {
    const [status, note, velocity] = event.data;
    const type = status & 0xf0;

    if (type === 144 && velocity > 0) {
      onNoteOn?.(note, velocity / 127);
    } else if (type === 128 || (type === 144 && velocity === 0)) {
      onNoteOff?.(note);
    }
  }, [onNoteOn, onNoteOff]);

  useEffect(() => {
    inputs.forEach((input) => {
      input.onmidimessage = handleMIDIMessage;
    });
    return () => {
      inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    };
  }, [inputs, handleMIDIMessage]);

  return { inputs, access };
};
