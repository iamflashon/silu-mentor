"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";

type CourseVideoPlayerProps = {
  resourceId: number;
  sourceUrl: string;
  title: string;
  startSeconds?: number;
  onTimeChange?: (seconds: number) => void;
  onError?: (message: string) => void;
  className?: string;
};

function isHlsUrl(value: string) {
  return /\.m3u8(?:[?#].*)?$/i.test(value.trim());
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
  onTimeChange,
  onError,
  className,
}: CourseVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl.trim()) return;

    const src = courseMediaUrl(resourceId, sourceUrl);
    const handleError = () => {
      onError?.(
        isHlsUrl(sourceUrl)
          ? "影片端拒絕目前網站來源，請在後台確認 CloudFront 來源權限或使用代理播放。"
          : "影片無法載入，請確認課程來源網址仍可使用。",
      );
    };

    video.addEventListener("error", handleError);
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
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [resourceId, sourceUrl, onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(startSeconds) || startSeconds <= 0) return;
    const seek = () => {
      if (Number.isFinite(video.duration) && video.duration > startSeconds) {
        video.currentTime = startSeconds;
      }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [startSeconds, sourceUrl]);

  return (
    <video
      ref={videoRef}
      className={className}
      controls
      preload="metadata"
      playsInline
      title={title}
      onTimeUpdate={(event) => onTimeChange?.(event.currentTarget.currentTime)}
    />
  );
}

