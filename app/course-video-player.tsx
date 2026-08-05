"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type CourseVideoPlayerProps = {
  resourceId: number;
  sourceUrl: string;
  title: string;
  startSeconds?: number;
  /** Changes only when the user explicitly asks the player to seek. */
  seekToken?: number;
  onTimeChange?: (seconds: number) => void;
  onError?: (message: string) => void;
  className?: string;
};

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlaybackRateSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="playback-rate-control">
      <span>播放速度</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label="播放速度">
        {PLAYBACK_RATES.map((rate) => (
          <option value={rate} key={rate}>{rate}×</option>
        ))}
      </select>
    </label>
  );
}

function isHlsUrl(value: string) {
  return /\.m3u8(?:[?#].*)?$/i.test(value.trim());
}

export function formatMediaTime(value: number | null | undefined) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function courseMediaUrl(resourceId: number, sourceUrl: string) {
  if (!isHlsUrl(sourceUrl)) return sourceUrl;
  const params = new URLSearchParams({
    resourceId: String(resourceId),
    target: sourceUrl,
  });
  return `/api/resources/media?${params.toString()}`;
}

export default function CourseVideoPlayer({
  resourceId,
  sourceUrl,
  title,
  startSeconds = 0,
  seekToken = 0,
  onTimeChange,
  onError,
  className,
}: CourseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastPlaybackTimeRef = useRef(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl.trim()) return;

    const src = courseMediaUrl(resourceId, sourceUrl);
    const applyPlaybackRate = () => {
      video.playbackRate = playbackRate;
    };
    const handleError = () => {
      onError?.(
        isHlsUrl(sourceUrl)
          ? "影片端拒絕目前網站來源，請在後台確認 CloudFront 來源權限或使用代理播放。"
          : "影片無法載入，請確認課程來源網址仍可使用。",
      );
    };

    video.addEventListener("error", handleError);
    video.addEventListener("loadedmetadata", applyPlaybackRate);
    applyPlaybackRate();
    if (isHlsUrl(sourceUrl) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) handleError();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }

    return () => {
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadedmetadata", applyPlaybackRate);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      lastPlaybackTimeRef.current = 0;
      video.removeAttribute("src");
      video.load();
    };
  // playbackRate is synchronized by the dedicated effect above; including it
  // here would tear down and reload the HLS stream whenever the user changes speed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, sourceUrl, onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(startSeconds)) return;
    const seek = () => {
      const desired = Math.max(0, startSeconds);
      if (!Number.isFinite(video.duration) || video.duration <= desired) return;
      if (desired === 0 && lastPlaybackTimeRef.current <= 1.25) return;
      // Ignore the parent's once-per-second progress display.  A real click
      // on a timestamp produces a meaningful jump and is still applied.
      const distance = Math.abs(lastPlaybackTimeRef.current - desired);
      if (lastPlaybackTimeRef.current === 0 || distance > 1.25) {
        video.currentTime = desired;
      }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  // Playback progress is reported to the parent every second.  It must not be
  // treated as a new seek request: assigning currentTime on every timeupdate
  // makes HLS rewind a fraction of a second repeatedly and can eventually
  // make the same media fragments play again.  Only a new resource or an
  // explicit seekToken is allowed to move the playhead.
  // startSeconds is intentionally excluded. Parents continuously report the
  // current playback time for progress and transcript highlighting; only an
  // explicit seekToken change may turn that display value into a seek.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId, sourceUrl, seekToken]);

  return (
    <>
      <video
        ref={videoRef}
        className={className}
        controls
        preload="metadata"
        playsInline
        title={title}
        onTimeUpdate={(event) => {
          lastPlaybackTimeRef.current = event.currentTarget.currentTime;
          onTimeChange?.(event.currentTarget.currentTime);
        }}
      />
      <div className="course-video-controls">
        <PlaybackRateSelect value={playbackRate} onChange={setPlaybackRate} />
      </div>
    </>
  );
}
