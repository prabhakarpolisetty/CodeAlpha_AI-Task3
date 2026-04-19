import React, { useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Note, VisualMode } from '../types';
import { audioEngine } from '../lib/audioEngine';

interface PianoRollProps {
  notes: Note[];
  currentStyle: string;
  onUpdateNote?: (noteId: string, updates: Partial<Note>, commit?: boolean) => void;
  onUpdateNotes?: (updates: { id: string, data: Partial<Note> }[], commit?: boolean) => void;
  onAddNotes?: (notes: Note[], commit?: boolean) => void;
  activeNoteIndex?: number | null;
  visualMode?: VisualMode;
}

const getAbsTime = (timeStr: string, timeSignatureNumerator: number = 4) => {
  const parts = timeStr.split(':').map(Number);
  const unitsPerBar = timeSignatureNumerator * 4;
  return (parts[0] || 0) * unitsPerBar + (parts[1] || 0) * 4 + (parts[2] || 0);
};

const absTimeToStr = (absTime: number, timeSignatureNumerator: number = 4) => {
  const unitsPerBar = timeSignatureNumerator * 4;
  const bars = Math.floor(absTime / unitsPerBar);
  const rem = absTime % unitsPerBar;
  const beats = Math.floor(rem / 4);
  const sub = rem % 4;
  return `${bars}:${beats}:${sub}`;
};

const durationMap: Record<string, number> = { '16n': 1, '8n': 2, '4n': 4, '2n': 8, '1n': 16 };
const revDurationMap: Record<number, string> = { 1: '16n', 2: '8n', 4: '4n', 8: '2n', 16: '1n' };

const SCALES: Record<string, number[]> = {
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Locrian': [0, 1, 3, 5, 6, 8, 10],
  'Pentatonic Maj': [0, 2, 4, 7, 9],
  'Pentatonic Min': [0, 3, 5, 7, 10]
};

const CHORDS: Record<string, number[]> = {
  'Major': [0, 4, 7],
  'Minor': [0, 3, 7],
  'Diminished': [0, 3, 6],
  'Augmented': [0, 4, 8],
  'Maj 7th': [0, 4, 7, 11],
  'Min 7th': [0, 3, 7, 10],
  'Dom 7th': [0, 4, 7, 10],
  'Maj 9th': [0, 4, 7, 11, 14],
  'Sus 4': [0, 5, 7],
  'Power': [0, 7, 12]
};

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const valueToPitch = (val: number) => {
  const notesArr = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(val / 12);
  const name = notesArr[val % 12];
  return `${name}${octave}`;
};

export const PianoRoll: React.FC<PianoRollProps> = ({ 
  notes, 
  currentStyle, 
  onUpdateNote,
  onUpdateNotes,
  onAddNotes,
  activeNoteIndex,
  visualMode = 'studio'
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentInstrument, setCurrentInstrument] = useState('Neuro-Synth');
  const [clipboard, setClipboard] = useState<Note[]>([]);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [reverbLevel, setReverbLevel] = useState(0.3);
  const [delayLevel, setDelayLevel] = useState(0.3);
  const [quantizeIntensity, setQuantizeIntensity] = useState(1.0);
  const [quantizeGrid, setQuantizeGrid] = useState(4); // Default to 4 (quarter notes)
  const [duplicateTranspose, setDuplicateTranspose] = useState(0); // Semitone offset
  const [keyTonic, setKeyTonic] = useState('C');
  const [keyScale, setKeyScale] = useState('Major');
  const [chordType, setChordType] = useState('Major');
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState(4);
  const [showScaleHighlight, setShowScaleHighlight] = useState(true);

  const handleReverbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setReverbLevel(val);
    audioEngine.setReverb(val);
  };

  const handleDelayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setDelayLevel(val);
    audioEngine.setDelay(val);
  };

  const handleInstrumentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value;
    setCurrentInstrument(type);
    audioEngine.setInstrument(type);
  };

  const handleTimeSignatureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const num = parseInt(e.target.value);
    setTimeSignatureNumerator(num);
    audioEngine.setTimeSignature(num);
  };

  const dragStartY = useRef<number>(0);
  const dragStartX = useRef<number>(0);
  const initialDetune = useRef<number>(0);
  const initialTimes = useRef<Map<string, number>>(new Map());
  const initialPitches = useRef<Map<string, number>>(new Map());
  const initialVelocities = useRef<Map<string, number>>(new Map());

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if target is not a textarea or input
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        if (selectedIds.size > 0) {
          const ids = Array.from(selectedIds);
          const selectedNotes = ids
            .map((id: string) => notes[parseInt(id)])
            .filter((n: Note | undefined): n is Note => n !== undefined);
          setClipboard(selectedNotes);
          setFlashMessage('COPIED TO NEURAL BUFFER');
          setTimeout(() => setFlashMessage(null), 1500);
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard.length > 0 && onAddNotes) {
          // Paste with an offset (e.g., 1 bar)
          const unitsPerBar = timeSignatureNumerator * 4;
          const offset = unitsPerBar; 
          const groupMapping: Record<string, string> = {};
          const pastedNotes = (clipboard as Note[]).map((n: Note) => {
            const abs = getAbsTime(n.time, timeSignatureNumerator);
            let newGroupId = n.groupId;
            if (n.groupId) {
              if (!groupMapping[n.groupId]) {
                groupMapping[n.groupId] = `group-${Date.now()}-${Math.round(Math.random() * 1000)}`;
              }
              newGroupId = groupMapping[n.groupId];
            }
            return { ...n, time: absTimeToStr(abs + offset, timeSignatureNumerator), groupId: newGroupId };
          });
          onAddNotes(pastedNotes, true);
          setFlashMessage('SEQUENCE REPLICATED');
          setTimeout(() => setFlashMessage(null), 1500);
          
          setSelectedIds(new Set());
        }
      }

      if (((e.ctrlKey || e.metaKey) && e.key === 'd') || e.key === 'd') {
        if (selectedIds.size > 0 && onAddNotes) {
          e.preventDefault();
          handleDuplicate();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, clipboard, notes, onAddNotes]);

  // Convert scientific pitch to numeric value for Y axis (approximate)
  const getNoteValue = (pitch: string) => {
    const notesArr = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const match = pitch.match(/([A-G][b#]?)(\d)/); // Improved regex for sharps/flats
    if (!match) return 60;
    const name = match[1];
    const octave = parseInt(match[2]);
    return octave * 12 + notesArr.indexOf(name);
  };

  const getGroupIds = (noteId: string): string[] => {
    const note = notes[parseInt(noteId)];
    if (!note?.groupId) return [noteId];
    
    return notes
      .map((n, i) => n.groupId === note.groupId ? i.toString() : null)
      .filter((id): id is string => id !== null);
  };

  const gridMarkers = useMemo(() => {
    if (notes.length === 0) return [];
    const unitsPerBar = timeSignatureNumerator * 4;
    const maxTime = Math.max(...notes.map(n => getAbsTime(n.time, timeSignatureNumerator) + (durationMap[n.duration] || 4)), 64);
    const totalBars = Math.ceil(maxTime / unitsPerBar) + 1;
    
    const markers = [];
    for (let i = 0; i < totalBars * unitsPerBar; i++) {
      if (i % 4 === 0) {
        markers.push({
          x: i * 20,
          type: i % unitsPerBar === 0 ? 'bar' : 'beat' as 'bar' | 'beat',
          label: i % unitsPerBar === 0 ? `${Math.floor(i / unitsPerBar) + 1}` : null
        });
      }
    }
    return markers;
  }, [notes, timeSignatureNumerator]);

  const isNoteInScale = (pitch: string) => {
    const val = getNoteValue(pitch);
    const tonicVal = TONICS.indexOf(keyTonic);
    const intervals = SCALES[keyScale] || SCALES['Major'];
    const relativeVal = (val - tonicVal + 120) % 12;
    return intervals.includes(relativeVal);
  };

  const handleScaleSnap = () => {
    if (!onUpdateNotes || selectedIds.size === 0) return;
    
    const tonicVal = TONICS.indexOf(keyTonic);
    const intervals = SCALES[keyScale] || SCALES['Major'];
    
    const updates = Array.from(selectedIds).map((id: string) => {
      const note = notes[parseInt(id)];
      if (!note) return null;
      
      const val = getNoteValue(note.pitch);
      const relativeVal = (val - tonicVal + 120) % 12;
      
      if (intervals.includes(relativeVal)) return null; // Already in scale
      
      // Calculate final snapped value using nearest neighbor in scale
      let targetVal = val;
      let minDiff = 13;
      for (let i = -6; i <= 6; i++) {
        const v = val + i;
        const rel = (v - tonicVal + 120) % 12;
        if (intervals.includes(rel)) {
          if (Math.abs(i) < minDiff) {
            minDiff = Math.abs(i);
            targetVal = v;
          }
        }
      }

      const update: { id: string, data: Partial<Note> } = {
        id,
        data: { pitch: valueToPitch(targetVal) }
      };
      return update;
    }).filter((u): u is { id: string, data: Partial<Note> } => u !== null);

    if (updates.length > 0) {
      onUpdateNotes(updates, true);
      setFlashMessage(`HARMONIC SNAP: ${keyTonic} ${keyScale.toUpperCase()}`);
      setTimeout(() => setFlashMessage(null), 1500);
    }
  };

  const parsedNotes = useMemo(() => {
    if (!notes.length) return [];
    
    const minNote = Math.min(...notes.map(n => getNoteValue(n.pitch)));
    const maxNote = Math.max(...notes.map(n => getNoteValue(n.pitch)));
    const range = Math.max(maxNote - minNote, 12);
    
    return notes.map((n, i) => {
      const absTime = getAbsTime(n.time);
      const detuneOffset = (n.detune || 0) / 10; // Visual offset based on detune (cents)
      const durationUnits = durationMap[n.duration] || 4;
      
      return {
        ...n,
        id: i.toString(),
        absTime,
        x: absTime * 20,
        y: 200 - ((getNoteValue(n.pitch) - minNote) / range) * 150 - detuneOffset,
        width: Math.max(10, durationUnits * 20 - 4),
        originalY: 200 - ((getNoteValue(n.pitch) - minNote) / range) * 150,
      };
    });
  }, [notes]);

  const handleNoteClick = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    const groupIds = getGroupIds(noteId);
    const newSelected = new Set(selectedIds);
    if (e.shiftKey) {
      const isSelecting = !groupIds.every(id => newSelected.has(id));
      if (isSelecting) {
        groupIds.forEach(id => newSelected.add(id));
      } else {
        groupIds.forEach(id => newSelected.delete(id));
      }
    } else {
      if (!groupIds.some(id => newSelected.has(id)) || newSelected.size > groupIds.length) {
        newSelected.clear();
        groupIds.forEach(id => newSelected.add(id));
      }
    }
    setSelectedIds(newSelected);
  };

  const handleMouseDown = (e: React.MouseEvent, noteId: string, currentDetune: number) => {
    e.stopPropagation();
    
    const groupIds = getGroupIds(noteId);
    
    // Selection logic first
    if (!groupIds.some(id => selectedIds.has(id))) {
      if (!e.shiftKey) {
        setSelectedIds(new Set(groupIds));
      } else {
        const next = new Set(selectedIds);
        groupIds.forEach(id => next.add(id));
        setSelectedIds(next);
      }
    }

    // Commit history
    if (onUpdateNotes) {
      // Create a snapshot for all notes that will be affected
      const currentSelection = !selectedIds.has(noteId) ? new Set(groupIds) : selectedIds;
      onUpdateNotes(Array.from(currentSelection).map(id => ({ id, data: {} })), true);
    }

    setDraggingId(noteId);
    dragStartY.current = e.clientY;
    dragStartX.current = e.clientX;
    initialDetune.current = currentDetune;
    
    // Store initial times and properties for all selected notes
    initialTimes.current.clear();
    initialPitches.current.clear();
    initialVelocities.current.clear();

    selectedIds.forEach((id: string) => {
      const noteIdx = parseInt(id);
      const note = notes[noteIdx];
      if (note) {
        initialTimes.current.set(id, getAbsTime(note.time));
        initialPitches.current.set(id, getNoteValue(note.pitch));
        initialVelocities.current.set(id, note.velocity);
      }
    });
  };

  const handleVelocityChange = (e: React.ChangeEvent<HTMLInputElement>, commit = false) => {
    if (!onUpdateNotes) return;
    const val = parseFloat(e.target.value);
    onUpdateNotes(Array.from(selectedIds).map((id: string) => ({ id, data: { velocity: val } })), commit);
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>, commit = false) => {
    if (!onUpdateNotes) return;
    const units = parseInt(e.target.value);
    const powers = [1, 2, 4, 8, 16];
    const closest = powers.reduce((prev, curr) => 
      Math.abs(curr - units) < Math.abs(prev - units) ? curr : prev
    );
    const durationStr = revDurationMap[closest] || '4n';
    onUpdateNotes(Array.from(selectedIds).map(id => ({ id, data: { duration: durationStr } })), commit);
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>, commit = false) => {
    if (!onUpdateNotes) return;
    const val = e.target.value.toUpperCase();
    // Basic validation for scientific pitch (e.g., C4, Eb3)
    if (/^[A-G][b#]?\d$/.test(val)) {
      onUpdateNotes(Array.from(selectedIds).map(id => ({ id, data: { pitch: val } })), commit);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>, commit = false) => {
    if (!onUpdateNotes) return;
    const val = e.target.value;
    if (/^\d+:\d+:\d+$/.test(val)) {
      onUpdateNotes(Array.from(selectedIds).map(id => ({ id, data: { time: val } })), commit);
    }
  };

  const handleDetuneChange = (e: React.ChangeEvent<HTMLInputElement>, commit = false) => {
    if (!onUpdateNotes) return;
    const val = parseFloat(e.target.value);
    onUpdateNotes(Array.from(selectedIds).map(id => ({ id, data: { detune: val } })), commit);
  };

  const triggerCommit = () => {
    if (onUpdateNotes && selectedIds.size > 0) {
      onUpdateNotes([], true);
    }
  };

  const handleQuantize = () => {
    if (!onUpdateNotes || selectedIds.size === 0) return;
    
    const ids = Array.from(selectedIds);
    const updates = ids.map((id: string) => {
      const noteIdx = parseInt(id);
      const note = notes[noteIdx];
      if (!note) return null;
      
      const currentAbs = getAbsTime(note.time);
      const targetAbs = Math.round(currentAbs / quantizeGrid) * quantizeGrid;
      const quantizedAbs = Math.round(currentAbs + (targetAbs - currentAbs) * quantizeIntensity);
      
      const update: { id: string, data: Partial<Note> } = { 
        id, 
        data: { time: absTimeToStr(quantizedAbs) } 
      };
      return update;
    }).filter((u): u is { id: string, data: Partial<Note> } => u !== null);

    onUpdateNotes(updates, true);
    setFlashMessage(`QUANTIZED TO 1/${16/quantizeGrid} BEATS`);
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleGroup = () => {
    if (!onUpdateNotes || selectedIds.size < 2) return;
    const groupId = `group-${Date.now()}`;
    const updates = Array.from(selectedIds).map((id: string) => ({ id, data: { groupId } }));
    onUpdateNotes(updates, true);
    setFlashMessage('SEQUENCE GROUPED');
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleUngroup = () => {
    if (!onUpdateNotes || selectedIds.size === 0) return;
    const updates = Array.from(selectedIds).map((id: string) => ({ id, data: { groupId: undefined } }));
    onUpdateNotes(updates, true);
    setFlashMessage('GROUP DISSOLVED');
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleDuplicate = () => {
    if (!onAddNotes || selectedIds.size === 0) return;
    
    // Create new notes with a slight offset (1 unit = 16th note)
    const offset = 1; 
    const groupMapping: Record<string, string> = {};
    const ids = Array.from(selectedIds);
    const newNotesArr = ids.map((id: string) => {
      const noteIdx = parseInt(id);
      const note = notes[noteIdx];
      if (!note) return null;
      
      const abs = getAbsTime(note.time);
      let newGroupId = note.groupId;
      if (note.groupId) {
        if (!groupMapping[note.groupId]) {
          groupMapping[note.groupId] = `group-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        }
        newGroupId = groupMapping[note.groupId];
      }

      // Handle transposition
      let pitch = note.pitch;
      if (duplicateTranspose !== 0) {
        const val = getNoteValue(note.pitch);
        pitch = valueToPitch(Math.max(0, Math.min(127, val + duplicateTranspose)));
      }
      
      return {
        ...note,
        pitch,
        time: absTimeToStr(abs + offset),
        groupId: newGroupId
      };
    }).filter((n): n is Note => n !== null);

    onAddNotes(newNotesArr, true);
    
    // Note: We don't automatically select the new notes here because onAddNotes 
    // happens outside this component and the notes array will be updated in the next render.
    setSelectedIds(new Set());
    
    setFlashMessage(duplicateTranspose !== 0 ? `SHIFT-DUPLICATED (+${duplicateTranspose}ST)` : 'MOTIF DOUBLED');
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleGenerateChord = () => {
    if (selectedIds.size === 0 || !onAddNotes) {
      setFlashMessage('SELECT ROOT NOTES FIRST');
      setTimeout(() => setFlashMessage(null), 1500);
      return;
    }
    
    const intervals = CHORDS[chordType] || CHORDS['Major'];
    const newNotesArr: Note[] = [];
    
    Array.from(selectedIds).forEach((id: string) => {
      const rootNote = notes[parseInt(id)];
      if (!rootNote) return;
      
      const rootVal = getNoteValue(rootNote.pitch);
      
      // Skip the first interval [0] as it's the root itself (already exists)
      intervals.slice(1).forEach(interval => {
        newNotesArr.push({
          ...rootNote,
          pitch: valueToPitch(Math.max(0, Math.min(127, rootVal + interval))),
        });
      });
    });
    
    if (newNotesArr.length > 0) {
      onAddNotes(newNotesArr, true);
      setFlashMessage(`${chordType.toUpperCase()} CHORD GENERATED`);
      setTimeout(() => setFlashMessage(null), 1500);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingId === null || !onUpdateNotes) return;
    
    const deltaY = dragStartY.current - e.clientY;
    const deltaX = e.clientX - dragStartX.current;
    
    // Velocity sensitivity factor (subtle change based on total drag distance)
    const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocityMod = (dragDistance / 1000) * 0.2; // Max 0.2 increase at 1000px drag

    const updates: { id: string, data: Partial<Note> }[] = [];

    // Detune logic (only for Lo-Fi)
    if (currentStyle === 'Lo-Fi') {
      const newDetune = Math.max(-100, Math.min(100, initialDetune.current + deltaY));
      
      selectedIds.forEach((id: string) => {
        const note = notes[parseInt(id)];
        if (note) {
          const initVel = initialVelocities.current.get(id) || 0.5;
          const newVel = Math.max(0.1, Math.min(1.0, initVel + velocityMod));

          updates.push({ id, data: { detune: newDetune, velocity: newVel } });
        }
      });

      // Play a preview sound if significant change
      const draggingNote = notes[parseInt(draggingId)];
      if (draggingNote && Math.abs(deltaY) % 5 === 0) {
        audioEngine.playNotePreview({...draggingNote, detune: newDetune});
      }
    } else {
      // Standard pitch shift logic
      const semitoneShift = Math.round(deltaY / 15); // Adjust sensitivity
      if (semitoneShift !== 0) {
        selectedIds.forEach((id: string) => {
          const initPitch = initialPitches.current.get(id);
          const initVel = initialVelocities.current.get(id) || 0.5;
          
          if (initPitch !== undefined) {
            const newPitchValue = Math.max(0, Math.min(127, initPitch + semitoneShift));
            const newPitch = valueToPitch(newPitchValue);
            const newVel = Math.max(0.1, Math.min(1.0, initVel + velocityMod));
            
            updates.push({ id, data: { pitch: newPitch, velocity: newVel } });
          }
        });
      }
    }

    // Time drag logic
    const deltaAbsTime = Math.round(deltaX / 20);
    if (deltaAbsTime !== 0) {
      selectedIds.forEach((id: string) => {
        const initial = initialTimes.current.get(id);
        if (initial !== undefined) {
          const newAbsTime = Math.max(0, initial + deltaAbsTime);
          const timeStr = absTimeToStr(newAbsTime);
          
          // Check if we already have an update for this ID (e.g. detune was added above)
          const existing = updates.find(u => u.id === id);
          if (existing) {
            existing.data.time = timeStr;
          } else {
            updates.push({ id, data: { time: timeStr } });
          }
        }
      });
    }

    if (updates.length > 0) {
      onUpdateNotes(updates);
    }
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  return (
    <div 
      className={`relative w-full bg-[#151619] border border-[#141414] rounded-lg overflow-hidden group shadow-inner ${draggingId ? 'cursor-ns-resize' : 'cursor-default'}`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={() => setSelectedIds(new Set())}
    >
      <div className="h-48 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
        
        {parsedNotes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#8E9299] font-mono text-xs uppercase tracking-widest italic">
            No sequence generated
          </div>
        ) : (
          <svg className="w-full h-full p-4 overflow-visible touch-none">
            {/* Rhythmic Grid Guide */}
            <g className="grid-lines">
              {gridMarkers.map((marker, i) => (
                <g key={`grid-${i}`}>
                  <line 
                    x1={marker.x} 
                    y1={-20} 
                    x2={marker.x} 
                    y2={220} 
                    stroke={marker.type === 'bar' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)'} 
                    strokeWidth={marker.type === 'bar' ? 1.5 : 1}
                  />
                  {marker.label && (
                    <text 
                      x={marker.x + 4} 
                      y={10} 
                      fontSize="8" 
                      fontFamily="monospace" 
                      fill="rgba(255, 255, 255, 0.2)"
                      className="select-none"
                    >
                      {marker.label}
                    </text>
                  )}
                </g>
              ))}
            </g>

            {parsedNotes.map((note, i) => (
              <g key={note.id} className="group/note">
                {/* Dragging guide */}
                {draggingId === note.id && (
                  <>
                    <line 
                      x1={note.x + note.width / 2} 
                      y1={note.originalY - 10} 
                      x2={note.x + note.width / 2} 
                      y2={note.originalY + 20} 
                      stroke="#FF6321" 
                      strokeWidth="0.5" 
                      strokeDasharray="1,2"
                      opacity="0.5"
                    />
                    <rect 
                      x={note.x - 10} 
                      y={note.originalY - 10} 
                      width={note.width + 20} 
                      height={20} 
                      fill="#FF6321" 
                      opacity="0.05"
                      className="pointer-events-none"
                    />
                  </>
                )}

                {/* Ghost line for original pitch if detuned */}
                {note.detune !== 0 && (
                  <line 
                    x1={note.x} 
                    y1={note.originalY + 4} 
                    x2={note.x + note.width} 
                    y2={note.originalY + 4} 
                    stroke="#333" 
                    strokeWidth="1" 
                    strokeDasharray="2,2" 
                  />
                )}
                
                {/* Connection line for detune visibility */}
                <line 
                  x1={note.x + note.width / 2} 
                  y1={note.originalY + 4} 
                  x2={note.x + note.width / 2} 
                  y2={note.y + 4} 
                  stroke={currentStyle === 'Lo-Fi' ? '#FF6321' : '#444'} 
                  strokeWidth="1"
                  opacity="0.3"
                />

                {/* Note Shape Rendering based on VisualMode */}
                {visualMode === 'neural' ? (
                  <circle
                    cx={note.x + note.width / 2}
                    cy={note.y + 4}
                    r={draggingId === note.id || activeNoteIndex === i ? 6 : 4}
                    fill={hoveredId === note.id ? '#FFB100' : (selectedIds.has(note.id) ? '#FF6321' : (activeNoteIndex === i ? '#FF6321' : (i % 2 === 0 ? '#FFFFFF' : '#8E9299')))}
                    stroke={showScaleHighlight && !isNoteInScale(note.pitch) ? '#ef4444' : (note.groupId ? 'rgba(255, 255, 255, 0.4)' : 'none')}
                    strokeWidth={showScaleHighlight && !isNoteInScale(note.pitch) ? 2 : (note.groupId ? 1 : 0)}
                    className={`transition-all duration-300 origin-center hover:scale-150 ${currentStyle === 'Lo-Fi' ? 'cursor-ns-resize' : ''}`}
                    style={{ 
                      opacity: note.velocity,
                      filter: hoveredId === note.id || activeNoteIndex === i || selectedIds.has(note.id) ? 'drop-shadow(0 0 8px rgba(255, 99, 33, 0.8))' : 'none'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, note.id, note.detune || 0)}
                    onClick={(e) => handleNoteClick(e, note.id)}
                    onMouseEnter={() => {
                      setHoveredId(note.id);
                      audioEngine.playNotePreview(note);
                    }}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                ) : visualMode === 'classic' ? (
                  <rect
                    x={note.x}
                    y={note.y}
                    width={note.duration.includes('1') ? 80 : note.duration.includes('2') ? 40 : 20}
                    height={draggingId === note.id || activeNoteIndex === i ? 10 : 8}
                    rx={1}
                    fill={hoveredId === note.id ? '#FFB100' : (selectedIds.has(note.id) ? '#FF6321' : (activeNoteIndex === i ? '#FF6321' : (i % 2 === 0 ? '#FFFFFF' : '#8E9299')))}
                    stroke={showScaleHighlight && !isNoteInScale(note.pitch) ? '#ef4444' : (note.groupId ? 'rgba(255, 255, 255, 0.4)' : 'none')}
                    strokeWidth={showScaleHighlight && !isNoteInScale(note.pitch) ? 2 : (note.groupId ? 1 : 0)}
                    className={`transition-all duration-150 origin-center hover:scale-110 ${currentStyle === 'Lo-Fi' ? 'cursor-ns-resize' : ''}`}
                    style={{ 
                      opacity: note.velocity,
                      filter: hoveredId === note.id || activeNoteIndex === i ? 'drop-shadow(0 0 4px rgba(255, 99, 33, 0.8))' : 'none'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, note.id, note.detune || 0)}
                    onClick={(e) => handleNoteClick(e, note.id)}
                    onMouseEnter={() => {
                      setHoveredId(note.id);
                      audioEngine.playNotePreview(note);
                    }}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                ) : (
                  <rect
                    x={note.x}
                    y={note.y}
                    width={note.width}
                    height={draggingId === note.id || activeNoteIndex === i ? 10 : 8}
                    rx={2}
                    fill={hoveredId === note.id ? '#FFB100' : (selectedIds.has(note.id) ? '#FF6321' : (activeNoteIndex === i ? '#FF6321' : (i % 2 === 0 ? '#FFFFFF' : '#8E9299')))}
                    stroke={showScaleHighlight && !isNoteInScale(note.pitch) ? '#ef4444' : (note.groupId ? 'rgba(255, 255, 255, 0.4)' : 'none')}
                    strokeWidth={showScaleHighlight && !isNoteInScale(note.pitch) ? 2 : (note.groupId ? 1 : 0)}
                    className={`transition-all duration-150 origin-center hover:scale-125 ${currentStyle === 'Lo-Fi' ? 'cursor-ns-resize' : ''} ${activeNoteIndex === i ? 'scale-110' : ''} ${selectedIds.has(note.id) ? 'stroke-white stroke-1' : ''}`}
                    style={{ 
                      opacity: note.velocity,
                      filter: hoveredId === note.id || activeNoteIndex === i ? 'drop-shadow(0 0 4px rgba(255, 99, 33, 0.8))' : 'none'
                    }}
                    onMouseDown={(e) => handleMouseDown(e, note.id, note.detune || 0)}
                    onClick={(e) => handleNoteClick(e, note.id)}
                    onMouseEnter={() => {
                      setHoveredId(note.id);
                      audioEngine.playNotePreview(note);
                    }}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                )}

                {/* Note Data Tooltip on hover */}
                <g className="opacity-0 group-hover/note:opacity-100 transition-opacity pointer-events-none">
                  <rect 
                    x={note.x - 2} 
                    y={note.y - 18} 
                    width={40} 
                    height={14} 
                    rx={2} 
                    fill="#000" 
                    stroke="#333" 
                  />
                  <text 
                    x={note.x} 
                    y={note.y - 8} 
                    className="text-[7px] fill-white font-mono font-bold uppercase"
                  >
                    {note.pitch} {note.duration} {currentStyle === 'Lo-Fi' ? `| ${Math.round(note.detune || 0)}c` : ''}
                  </text>
                </g>
              </g>
            ))}
          </svg>
        )}
      </div>

      {/* Neural Note Inspector */}
      {selectedIds.size > 0 && (
        <div className="bg-[#121214] border-y border-[#222] p-3 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            {/* Header info */}
            <div className="flex flex-col min-w-[100px]">
              <span className="text-[10px] font-mono font-bold text-[#FF6321] uppercase tracking-[0.2em]">
                Note Inspector
              </span>
              <span className="text-[8px] font-mono text-[#555] uppercase mt-0.5">
                {selectedIds.size} {selectedIds.size === 1 ? 'cell' : 'cells'} active
              </span>
            </div>

            {/* Pitch & Time Row */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Pitch</label>
                <input 
                  type="text"
                  key={`pitch-${[...selectedIds][0]}`}
                  defaultValue={notes[parseInt([...selectedIds][0])]?.pitch || 'C4'}
                  onBlur={(e) => handlePitchChange(e as any, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handlePitchChange(e as any, true);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="bg-[#1a1b1e] border border-[#333] text-white text-[10px] font-mono px-2 py-1 rounded w-16 focus:border-[#FF6321] outline-none transition-colors"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Time (B:B:S)</label>
                <input 
                  type="text"
                  key={`time-${[...selectedIds][0]}`}
                  defaultValue={notes[parseInt([...selectedIds][0])]?.time || '0:0:0'}
                  onBlur={(e) => handleTimeChange(e as any, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTimeChange(e as any, true);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="bg-[#1a1b1e] border border-[#333] text-white text-[10px] font-mono px-2 py-1 rounded w-20 focus:border-[#FF6321] outline-none transition-colors"
                />
              </div>
            </div>

            <div className="w-px h-8 bg-[#222] hidden lg:block" />

            {/* Velocity Slider */}
            <div className="flex-1 min-w-[180px] flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Velocity</label>
                <span className="text-[9px] font-mono text-white">
                  {Math.round((notes[parseInt([...selectedIds][0])]?.velocity || 0) * 100)}%
                </span>
              </div>
              <input 
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={notes[parseInt([...selectedIds][0])]?.velocity || 0.5}
                onMouseDown={triggerCommit}
                onChange={(e) => handleVelocityChange(e, false)}
                className="w-full accent-[#FF6321] h-1"
              />
            </div>

            {/* Duration Slider */}
            <div className="flex-1 min-w-[150px] flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Duration</label>
                <span className="text-[9px] font-mono text-white">
                  {notes[parseInt([...selectedIds][0])]?.duration.replace('n', '')}
                </span>
              </div>
              <input 
                type="range"
                min="1"
                max="16"
                step="1"
                value={durationMap[notes[parseInt([...selectedIds][0])]?.duration] || 4}
                onMouseDown={triggerCommit}
                onChange={(e) => handleDurationChange(e, false)}
                className="w-full accent-white h-1"
              />
            </div>

            {/* Detune Slider (Lo-Fi specialized) */}
            {currentStyle === 'Lo-Fi' && (
              <div className="flex-1 min-w-[150px] flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Detune</label>
                  <span className="text-[9px] font-mono text-white">
                    {Math.round(notes[parseInt([...selectedIds][0])]?.detune || 0)}c
                  </span>
                </div>
                <input 
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={notes[parseInt([...selectedIds][0])]?.detune || 0}
                  onMouseDown={triggerCommit}
                  onChange={(e) => handleDetuneChange(e, false)}
                  className="w-full accent-blue-500 h-1"
                />
              </div>
            )}

            <div className="w-px h-8 bg-[#222] hidden xl:block" />

            {/* Harmonics / Scale Control */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Harmonics</label>
                <div className="flex items-center gap-1.5">
                  <select 
                    value={keyTonic} 
                    onChange={(e) => setKeyTonic(e.target.value)}
                    className="bg-[#1a1b1e] border border-[#333] text-[9px] text-white rounded px-1.5 py-1 h-6 outline-none focus:border-[#FF6321]"
                  >
                    {TONICS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select 
                    value={keyScale} 
                    onChange={(e) => setKeyScale(e.target.value)}
                    className="bg-[#1a1b1e] border border-[#333] text-[9px] text-white rounded px-1.5 py-1 h-6 outline-none focus:border-[#FF6321]"
                  >
                    {Object.keys(SCALES).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button 
                    onClick={handleScaleSnap}
                    disabled={selectedIds.size === 0}
                    title="Snap selected notes to scale"
                    className="h-6 px-2 bg-blue-600/20 border border-blue-500/30 text-blue-400 text-[9px] font-bold rounded uppercase hover:bg-blue-500 hover:text-white transition-all disabled:opacity-20"
                  >
                    Mirror Key
                  </button>
                  <button 
                    onClick={() => setShowScaleHighlight(!showScaleHighlight)}
                    className={`h-6 w-6 flex items-center justify-center border rounded transition-all ${showScaleHighlight ? 'border-amber-500/50 text-amber-500 bg-amber-500/10' : 'border-[#333] text-[#555]'}`}
                    title="Toggle scale highlighting"
                  >
                    <div className="w-2 h-2 rounded-full bg-current" />
                  </button>
                </div>
              </div>
            </div>

            <div className="w-px h-8 bg-[#222] hidden xl:block" />

            {/* Quick Actions (Quantize) */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Alignment</label>
                <div className="flex items-center gap-1.5">
                  <select 
                    value={quantizeGrid} 
                    onChange={(e) => setQuantizeGrid(parseInt(e.target.value))}
                    className="bg-[#1a1b1e] border border-[#333] text-[9px] text-[#8E9299] rounded px-1.5 py-1 h-6 outline-none focus:border-[#FF6321]"
                  >
                    <option value="16">1/1</option>
                    <option value="8">1/2</option>
                    <option value="4">1/4</option>
                    <option value="2">1/8</option>
                    <option value="1">1/16</option>
                  </select>
                  <button 
                    onClick={handleQuantize}
                    className="h-6 px-3 bg-[#FF6321] text-white text-[9px] font-bold rounded uppercase hover:bg-white hover:text-black transition-all active:scale-95"
                  >
                    Quantize
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Grouping</label>
                <div className="flex items-center gap-1.5">
                  <button 
                    onClick={handleGroup}
                    disabled={selectedIds.size < 2}
                    className="h-6 px-3 border border-[#333] text-white text-[9px] font-bold rounded uppercase hover:border-[#FF6321] disabled:opacity-30 disabled:hover:border-[#333] transition-all"
                  >
                    Group
                  </button>
                  <button 
                    onClick={handleUngroup}
                    className="h-6 px-3 border border-[#333] text-white text-[9px] font-bold rounded uppercase hover:border-red-500 transition-all font-mono"
                  >
                    Ungroup
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Mirroring</label>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 bg-[#1a1b1e] border border-[#333] rounded px-1.5 h-6">
                    <span className="text-[9px] text-[#555] font-mono">Shift:</span>
                    <select 
                      value={duplicateTranspose} 
                      onChange={(e) => setDuplicateTranspose(parseInt(e.target.value))}
                      className="bg-transparent text-[9px] text-[#FF6321] outline-none"
                    >
                      <option value="0">Unison</option>
                      <option value="12">Octave</option>
                      <option value="-12">-Octave</option>
                      <option value="7">Fifth</option>
                      <option value="4">Maj Third</option>
                      <option value="3">Min Third</option>
                      <option value="5">Fourth</option>
                      <option value="2">Second</option>
                    </select>
                  </div>
                  <button 
                    onClick={handleDuplicate}
                    className="h-6 px-3 bg-[#333] text-[#FF6321] border border-[#FF6321] text-[9px] font-bold rounded uppercase hover:bg-[#FF6321] hover:text-white transition-all shadow-[0_0_10px_rgba(255,99,33,0.2)]"
                  >
                    Duplicate
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[8px] font-mono uppercase text-[#8E9299] tracking-widest">Chord Archetype</label>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 bg-[#1a1b1e] border border-[#333] rounded px-1.5 h-6">
                    <select 
                      value={chordType} 
                      onChange={(e) => setChordType(e.target.value)}
                      className="bg-transparent text-[9px] text-[#FF6321] outline-none"
                    >
                      {Object.keys(CHORDS).map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={handleGenerateChord}
                    className="h-6 px-3 bg-[#FF6321] text-white border border-[#FF6321] text-[9px] font-bold rounded uppercase hover:bg-white hover:text-black transition-all shadow-[0_0_15px_rgba(255,99,33,0.3)]"
                  >
                    Build Chord
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FX Control Rack */}
      <div className="bg-[#1a1b1e] border-t border-[#222] p-3 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3 min-w-[150px] flex-1">
          <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] whitespace-nowrap">
            Reverb
          </label>
          <input 
            type="range"
            min="0"
            max="1.0"
            step="0.01"
            value={reverbLevel}
            onChange={handleReverbChange}
            className="flex-1 accent-[#FF6321] h-1"
          />
          <span className="text-[9px] font-mono text-white min-w-[3ch]">
            {Math.round(reverbLevel * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-3 min-w-[150px] flex-1">
          <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] whitespace-nowrap">
            Delay
          </label>
          <input 
            type="range"
            min="0"
            max="1.0"
            step="0.01"
            value={delayLevel}
            onChange={handleDelayChange}
            className="flex-1 accent-[#FF6321] h-1"
          />
          <span className="text-[9px] font-mono text-white min-w-[3ch]">
            {Math.round(delayLevel * 100)}%
          </span>
        </div>

        <div className="flex-1 min-w-[150px] flex flex-col gap-1.5">
          <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] whitespace-nowrap">
            Instrument
          </label>
          <select 
            value={currentInstrument}
            onChange={handleInstrumentChange}
            className="bg-[#151619] border border-[#333] text-[10px] text-white rounded px-2 py-1 outline-none focus:border-[#FF6321] transition-all"
          >
            <option value="FM-Piano">Piano (FM)</option>
            <option value="Neuro-Synth">Synth (Neuro)</option>
            <option value="Deep-Bass">Bass (Deep)</option>
            <option value="Atmos-Pad">Pad (Atmos)</option>
            <option value="Strings">Strings (Ensemble)</option>
            <option value="Lo-Fi">Lo-Fi Keys</option>
          </select>
        </div>

        <div className="flex-none min-w-[70px] flex flex-col gap-1.5">
          <label className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299] whitespace-nowrap">
            Meter
          </label>
          <select 
            value={timeSignatureNumerator}
            onChange={handleTimeSignatureChange}
            className="bg-[#151619] border border-[#333] text-[10px] text-white rounded px-2 py-1 outline-none focus:border-[#FF6321] transition-all"
          >
            <option value="2">2/4</option>
            <option value="3">3/4</option>
            <option value="4">4/4</option>
            <option value="5">5/4</option>
            <option value="6">6/4</option>
            <option value="7">7/4</option>
          </select>
        </div>
      </div>

      {/* Decorative hardware elements */}
      <div className="absolute top-2 left-2 flex gap-1 pointer-events-none">
        <div className="w-1.5 h-1.5 rounded-full bg-[#333]" />
        <div className="w-1.5 h-1.5 rounded-full bg-[#333]" />
      </div>
      <div className="absolute top-2 right-2 flex gap-1 items-center pointer-events-none">
        <span className="text-[8px] font-mono text-[#444] uppercase tracking-tighter">
          {currentStyle === 'Lo-Fi' ? 'WARBLE MODE ACTIVE' : 'Visualizer Core v1.0'}
        </span>
      </div>

      {/* Action Flash Overlay */}
      <AnimatePresence>
        {flashMessage && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-x-0 bottom-12 flex justify-center pointer-events-none"
          >
            <div className="bg-[#FF6321] text-white text-[10px] font-bold px-4 py-1.5 rounded-full shadow-[0_0_20px_rgba(255,100,0,0.4)] tracking-[0.2em] uppercase">
              {flashMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
