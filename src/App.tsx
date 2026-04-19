import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Square, 
  Music, 
  Download, 
  RotateCcw, 
  Settings2,
  Sparkles,
  Command,
  Info,
  Undo2,
  Redo2,
  Trello,
  LayoutGrid,
  Zap
} from 'lucide-react';
import { generateComposition } from './services/geminiMusic';
import { audioEngine } from './lib/audioEngine';
import { PianoRoll } from './components/PianoRoll';
import { MusicStyle, Note, Composition, VisualMode } from './types';
import { useMIDI, midiNoteToPitch } from './hooks/useMIDI';
import MidiWriter from 'midi-writer-js';

const STYLES: MusicStyle[] = ['Classical', 'Jazz', 'Cyberpunk', 'Lo-Fi', 'Ambient', 'Minimalist'];

export default function App() {
  const [currentStyle, setCurrentStyle] = useState<MusicStyle>('Cyberpunk');
  const [visualMode, setVisualMode] = useState<VisualMode>('studio');
  const [composition, setComposition] = useState<Composition | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [activeNoteIndex, setActiveNoteIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<Composition[]>([]);
  const [future, setFuture] = useState<Composition[]>([]);
  const pendingNotes = useRef<Map<number, { pitch: string; startTime: string; velocity: number }>>(new Map());

  const handleMIDIOn = useCallback((note: number, velocity: number) => {
    const pitch = midiNoteToPitch(note);
    audioEngine.triggerAttack(pitch, velocity);
    
    if (isRecording) {
      // Get current position as B:B:S
      const pos = audioEngine.getCurrentPosition();
      // Tone.Transport.position can be an object or string, usually a string when polled
      const posStr = typeof pos === 'string' ? pos.split('.')[0] : "0:0:0"; // Strip sub-beat decimals if any
      pendingNotes.current.set(note, { pitch, startTime: posStr, velocity });
    }
  }, [isRecording]);

  const handleMIDIOff = useCallback((note: number) => {
    const pitch = midiNoteToPitch(note);
    audioEngine.triggerRelease(pitch);

    if (isRecording && pendingNotes.current.has(note)) {
      const data = pendingNotes.current.get(note)!;
      pendingNotes.current.delete(note);
      
      const endPos = audioEngine.getCurrentPosition();
      const endPosStr = typeof endPos === 'string' ? endPos.split('.')[0] : "0:0:0";
      
      // Calculate duration units (simplistic 4n for now or calculate ticks)
      // For now let's just use 4n or dynamic
      const newNote: Note = {
        pitch: data.pitch,
        duration: '4n', // Default for now
        time: data.startTime,
        velocity: data.velocity,
      };
      
      setComposition(prev => {
        if (!prev) return null;
        return { ...prev, notes: [...prev.notes, newNote] };
      });
    }
  }, [isRecording]);

  useMIDI(handleMIDIOn, handleMIDIOff);

  useEffect(() => {
    // Stop playback and reset active note if composition changes
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
      setActiveNoteIndex(null);
    }
  }, [composition]);

  const pushToHistory = (current: Composition) => {
    setHistory(prev => [...prev.slice(-19), current]); // Keep last 20
    setFuture([]);
  };

  const handleInitAudio = async () => {
    await audioEngine.init();
    setIsAudioReady(true);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      if (!isAudioReady) await handleInitAudio();
      
      const { notes, tempo } = await generateComposition(currentStyle, customPrompt);
      const newComp: Composition = {
        id: Math.random().toString(36).substr(2, 9),
        name: `${currentStyle} Draft #${Math.floor(Math.random() * 1000)}`,
        style: currentStyle,
        notes,
        tempo,
        createdAt: Date.now(),
      };
      
      if (composition) pushToHistory(composition);
      setComposition(newComp);
      audioEngine.setTempo(tempo);
      setIsGenerating(false);
      setActiveNoteIndex(null);
    } catch (err) {
      console.error(err);
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying || isRecording) {
      audioEngine.stop();
      setIsPlaying(false);
      setIsRecording(false);
      setActiveNoteIndex(null);
    } else if (composition) {
      audioEngine.playSequence(composition.notes, (index) => {
        setActiveNoteIndex(index);
        // Clear highlight after a short duration (approximate note duration)
        setTimeout(() => setActiveNoteIndex(prev => prev === index ? null : prev), 200);
      });
      setIsPlaying(true);
    }
  };

  const toggleRecord = () => {
    if (isRecording) {
      audioEngine.stop();
      setIsRecording(false);
    } else {
      if (!isAudioReady) handleInitAudio().then(() => {
        audioEngine.startTransport();
        setIsRecording(true);
      });
      else {
        audioEngine.startTransport();
        setIsRecording(true);
      }
    }
  };

  const handleDownloadMidi = () => {
    if (!composition) return;

    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 }));
    track.setTempo(composition.tempo);

    composition.notes.forEach(note => {
      // Simplistic conversion of Tone.js "4n" to MidiWriter durations
      const durationMap: Record<string, string> = {
        '1n': '1', '2n': '2', '4n': '4', '8n': '8', '16n': '16'
      };
      track.addEvent(new MidiWriter.NoteEvent({
        pitch: [note.pitch],
        duration: durationMap[note.duration] || '4',
        velocity: Math.floor(note.velocity * 127),
        startTick: 0 // Simplistic start tick
      }));
    });

    const write = new MidiWriter.Writer(track);
    const dataUri = write.dataUri();
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = `${composition.name.replace(/\s+/g, '_')}.mid`;
    link.click();
  };

  const updateNotes = (updates: { id: string, data: Partial<Note> }[], commit: boolean = false) => {
    if (!composition) return;
    
    if (commit) {
      pushToHistory(composition);
    }

    setComposition(prev => {
      if (!prev) return null;
      const newNotes = prev.notes.map((n, i) => {
        const update = updates.find(u => u.id === i.toString());
        if (update) return { ...n, ...update.data };
        return n;
      });
      return { ...prev, notes: newNotes };
    });
  };

  const updateNote = (noteId: string, updates: Partial<Note>, commit: boolean = false) => {
    updateNotes([{ id: noteId, data: updates }], commit);
  };

  const addNotes = (newNotes: Note[], commit: boolean = false) => {
    if (!composition) return;
    if (commit) pushToHistory(composition);
    setComposition({ ...composition, notes: [...composition.notes, ...newNotes] });
  };

  const undo = () => {
    if (history.length === 0 || !composition) return;
    const prev = history[history.length - 1];
    setFuture(f => [composition, ...f]);
    setHistory(h => h.slice(0, -1));
    setComposition(prev);
  };

  const redo = () => {
    if (future.length === 0 || !composition) return;
    const next = future[0];
    setHistory(h => [...h, composition]);
    setFuture(f => f.slice(1));
    setComposition(next);
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl/Cmd + Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
        undo();
      }
      // Redo: Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z
      if (((e.ctrlKey || e.metaKey) && e.key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z')) {
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
        redo();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [history, future, composition]);

  return (
    <div className="h-screen w-full bg-[#0d0e10] text-white font-sans overflow-hidden relative">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-orange-500/10 blur-[140px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[70%] h-[70%] bg-blue-900/10 blur-[140px] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full h-full flex flex-col overflow-hidden"
      >
        {/* Header Rail */}
        <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#151619]/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-black">
              <Sparkles size={18} fill="currentColor" />
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest leading-none">MuseAI Studio</h1>
              <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-tighter opacity-70">Neural Composition Engine</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[#8E9299]">
            <div className="flex items-center gap-2 mr-2">
              <button 
                onClick={undo}
                disabled={history.length === 0}
                className="p-2 transition-colors hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                title="Undo"
              >
                <Undo2 size={16} />
              </button>
              <button 
                onClick={redo}
                disabled={future.length === 0}
                className="p-2 transition-colors hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                title="Redo"
              >
                <Redo2 size={16} />
              </button>
            </div>
            <div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-orange-500 animate-pulse' : 'bg-green-500'}`} />
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Controls Sidebar */}
          <div className="lg:col-span-3 p-6 border-r border-[#222] bg-[#1a1b1e]/30 backdrop-blur-sm overflow-y-auto custom-scrollbar">
            <div className="space-y-8">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] block mb-3 pl-1">Style Matrix</label>
                <div className="grid grid-cols-2 gap-2">
                  {STYLES.map(style => (
                    <button
                      key={style}
                      onClick={() => setCurrentStyle(style)}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all duration-200 uppercase tracking-tight ${
                        currentStyle === style 
                        ? 'bg-white text-black border-white' 
                        : 'border-[#333] text-[#8E9299] hover:border-[#555]'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299] block mb-2 pl-1">Generation Context</label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Minor key, melancholic, fast tempo..."
                  className="w-full h-32 bg-[#0d0e10]/50 border border-[#333] rounded-xl p-4 text-xs placeholder-[#444] focus:outline-none focus:border-[#666] transition-colors resize-none font-mono"
                />
              </div>

              <div className="pt-2">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-bold uppercase tracking-widest transition-all ${
                    isGenerating 
                    ? 'bg-[#333] cursor-not-allowed text-[#666]' 
                    : 'bg-white text-black hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-t-transparent border-black rounded-full animate-spin" />
                      Composing...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={18} />
                      Generate
                    </>
                  )}
                </button>
              </div>

              {/* Engine Stats */}
              <div className="space-y-3 pt-6 border-t border-[#222]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#222] text-[#8E9299]">
                    <Settings2 size={16} />
                  </div>
                  <div>
                    <h4 className="text-[10px] uppercase font-bold text-[#8E9299] tracking-widest mb-0.5">Engine Status</h4>
                    <p className="text-[10px] font-mono text-green-500 uppercase">Synchronized</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#222] text-[#8E9299]">
                    <Info size={16} />
                  </div>
                  <div>
                    <h4 className="text-[10px] uppercase font-bold text-[#8E9299] tracking-widest mb-0.5">Latency</h4>
                    <p className="text-[10px] font-mono text-white uppercase">~1.2s Burst</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Visualization Area */}
          <div className="lg:col-span-9 p-0 flex flex-col overflow-hidden bg-[#0d0e10]/20">
            <div className="flex-1 flex flex-col p-6 space-y-6 overflow-hidden">
              <div className="flex items-center justify-between flex-none">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${composition ? 'bg-[#FF6321]' : 'bg-[#222]'}`}>
                    <Music className={composition ? 'text-white' : 'text-[#444]'} size={20} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-widest font-mono text-[#8E9299]">
                      {composition ? 'Project' : 'Idle'}
                    </h2>
                    <p className="text-sm font-medium">
                      {composition ? composition.name : 'Ready for generation'}
                    </p>
                  </div>
                </div>
                
                {composition && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#1a1b1e] rounded-lg p-0.5 border border-[#333] mr-2">
                      <button 
                        onClick={() => setVisualMode('studio')}
                        className={`p-1.5 rounded-md transition-all ${visualMode === 'studio' ? 'bg-[#333] text-[#FF6321]' : 'text-[#8E9299] hover:text-white'}`}
                        title="Studio Mode"
                      >
                        <Trello size={14} />
                      </button>
                      <button 
                        onClick={() => setVisualMode('neural')}
                        className={`p-1.5 rounded-md transition-all ${visualMode === 'neural' ? 'bg-[#333] text-[#FF6321]' : 'text-[#8E9299] hover:text-white'}`}
                        title="Neural Mode"
                      >
                        <Zap size={14} />
                      </button>
                      <button 
                        onClick={() => setVisualMode('classic')}
                        className={`p-1.5 rounded-md transition-all ${visualMode === 'classic' ? 'bg-[#333] text-[#FF6321]' : 'text-[#8E9299] hover:text-white'}`}
                        title="Classic Mode"
                      >
                        <LayoutGrid size={14} />
                      </button>
                    </div>
                    <div className="px-3 py-1 rounded-md border border-[#333] font-mono text-[10px] text-[#8E9299]">
                      {composition.tempo} BPM
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 bg-[#0d0e10]/40 rounded-2xl border border-[#222] overflow-hidden relative group">
                <PianoRoll 
                  notes={composition?.notes || []} 
                  currentStyle={currentStyle} 
                  onUpdateNote={updateNote}
                  onUpdateNotes={updateNotes}
                  onAddNotes={addNotes}
                  activeNoteIndex={activeNoteIndex}
                  visualMode={visualMode}
                />
              </div>

              <div className="flex items-center gap-3 flex-none">
                <button
                  onClick={togglePlay}
                  disabled={!composition || isRecording}
                  className={`flex-1 py-4 px-6 rounded-2xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest transition-all ${
                    !composition || isRecording
                    ? 'bg-[#1a1b1e] text-[#333] cursor-not-allowed border border-[#222]' 
                    : 'bg-[#222] text-white hover:bg-[#333] border border-[#444]'
                  }`}
                >
                  {isPlaying ? <Square size={20} fill="white" /> : <Play size={20} fill="white" />}
                  {isPlaying ? 'Stop' : 'Playback'}
                </button>

                <button
                  onClick={toggleRecord}
                  title="Record MIDI"
                  className={`p-4 rounded-2xl flex items-center justify-center transition-all ${
                    isRecording 
                    ? 'bg-red-500 text-white animate-pulse' 
                    : 'bg-[#222] text-[#8E9299] hover:text-white border border-[#333]'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white' : 'bg-red-500'}`} />
                </button>
                
                <button
                  onClick={handleDownloadMidi}
                  disabled={!composition}
                  title="Export MIDI"
                  className={`p-4 rounded-2xl flex items-center justify-center transition-all ${
                    !composition 
                    ? 'bg-[#1a1b1e] text-[#333] cursor-not-allowed border border-[#222]' 
                    : 'bg-white text-black hover:bg-gray-200'
                  }`}
                >
                  <Download size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {!isAudioReady && (
        <AnimatePresence>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-6"
          >
            <div className="max-w-md w-full bg-[#151619] border border-[#333] p-8 rounded-3xl text-center shadow-2xl space-y-6">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-black mx-auto">
                <Play size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white uppercase tracking-wider">Initialize Studio</h3>
                <p className="text-[#8E9299] text-sm">Welcome to MuseAI. Click below to activate the neural synthesis engine and enable audio capabilities.</p>
              </div>
              <button 
                onClick={handleInitAudio}
                className="w-full py-4 bg-white text-black font-bold uppercase tracking-widest rounded-2xl hover:scale-[1.02] transition-transform"
              >
                Engage Engine
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Action Flash Overlay */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 pointer-events-none z-[100]">
        <style dangerouslySetInnerHTML={{ __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #444; }
        `}} />
      </div>
    </div>
  );
}
