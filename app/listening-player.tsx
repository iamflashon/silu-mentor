"use client";

import { useEffect, useRef, useState } from "react";

export type ListeningFeed = {
  id: number;
  title: string;
  year: string;
  subject: string;
  audioUrl: string;
  audioSegments?: Array<{
    id: number;
    audioUrl: string;
    durationSeconds: number;
    sequence: number;
  }>;
};

export function ListeningPlayer({ item, compact = false }: { item: ListeningFeed; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [resumeAfterSwitch, setResumeAfterSwitch] = useState(false);
  const segments = item.audioSegments?.length
    ? item.audioSegments
    : [{ id: item.id, audioUrl: item.audioUrl, durationSeconds: 0, sequence: 0 }];
  const current = segments[segmentIndex];

  useEffect(() => {
    if (!resumeAfterSwitch || !audioRef.current) return;
    const playResult = audioRef.current.play();
    if (playResult) playResult.catch(() => undefined).finally(() => setResumeAfterSwitch(false));
    else setResumeAfterSwitch(false);
  }, [segmentIndex, resumeAfterSwitch]);

  return (
    <div className={`listening-player${compact ? " compact" : ""}`}>
      <audio
        key={`${item.id}-${current.id}`}
        ref={audioRef}
        controls
        preload="none"
        src={current.audioUrl}
        onEnded={() => {
          if (segmentIndex < segments.length - 1) {
            setResumeAfterSwitch(true);
            setSegmentIndex((value) => value + 1);
          }
        }}
      />
      {segments.length > 1 && <small>分段 {segmentIndex + 1}/{segments.length}，播放完會自動接續</small>}
    </div>
  );
}
