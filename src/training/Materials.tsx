import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Material } from "./types";
GlobalWorkerOptions.workerSrc = worker;
type Player = {
  destroy(): void;
  getCurrentTime(): number;
  seekTo(n: number, allow: boolean): void;
  getPlayerState(): number;
};
type YouTube = { Player: new (el: HTMLElement, config: object) => Player };
declare global {
  interface Window {
    YT?: YouTube;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeReady: Promise<void> | undefined;
function loadYouTube() {
  return (youtubeReady ??= new Promise<void>((resolve, reject) => {
    if (window.YT) {
      resolve();
      return;
    }
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      youtubeReady = undefined;
      reject(new Error("YouTube 播放器載入失敗"));
    };
    document.head.append(s);
  }));
}
export function Materials({
  material,
  position,
  onState,
  onPosition,
}: {
  material: Material;
  position: number;
  onState: (loaded: boolean, playing: boolean, error?: string) => void;
  onPosition: (n: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(Math.max(1, Math.floor(position) || 1));
  const [pages, setPages] = useState(1);
  const state = useRef(onState);
  const pos = useRef(onPosition);
  state.current = onState;
  pos.current = onPosition;
  useEffect(() => {
    state.current(false, false);
    if (material.kind === "text") {
      state.current(true, false);
      return;
    }
    if (material.kind === "youtube") {
      let cancelled = false;
      let player: Player | undefined;
      let timer: number | undefined;
      void loadYouTube()
        .then(() => {
          if (cancelled || !root.current || !window.YT) return;
          const el = document.createElement("div");
          root.current.replaceChildren(el);
          player = new window.YT.Player(el, {
            videoId: material.content,
            playerVars: { origin: location.origin, playsinline: 1 },
            events: {
              onReady: () => {
                player?.seekTo(position, true);
                state.current(true, false);
              },
              onStateChange: () => {
                const s = player?.getPlayerState();
                state.current(s !== -1, s === 1);
              },
              onError: () =>
                state.current(
                  false,
                  false,
                  "影片已刪除、禁止內嵌或無法播放，請回報管理員。",
                ),
            },
          });
          timer = window.setInterval(() => {
            if (player) pos.current(player.getCurrentTime());
          }, 1000);
        })
        .catch((e) => state.current(false, false, e.message));
      return () => {
        cancelled = true;
        clearInterval(timer);
        player?.destroy();
      };
    }
  }, [material.id, material.kind, material.content]);
  useEffect(() => {
    if (material.kind !== "pdf") return;
    let cancelled = false;
    state.current(false, false);
    const task = getDocument({ url: material.content, isEvalSupported: false });
    void task.promise
      .then(async (pdf) => {
        if (cancelled) return;
        setPages(pdf.numPages);
        const pn = Math.min(page, pdf.numPages);
        const p = await pdf.getPage(pn);
        const viewport = p.getViewport({ scale: 1.3 });
        const cv = canvas.current;
        if (cancelled || !cv) return;
        cv.width = viewport.width;
        cv.height = viewport.height;
        await p.render({ canvas: cv, viewport }).promise;
        if (!cancelled) {
          state.current(true, false);
          pos.current(pn);
        }
      })
      .catch(() => {
        if (!cancelled)
          state.current(
            false,
            false,
            "PDF 無法載入；請確認檔案與跨來源讀取設定後重試或回報。",
          );
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [material.id, material.content, page, material.kind]);
  if (material.kind === "text")
    return (
      <article
        className="text-material"
        onScroll={(e) => pos.current(e.currentTarget.scrollTop)}
        ref={(el) => {
          if (el && position > 0 && el.scrollTop === 0) el.scrollTop = position;
        }}
      >
        {material.content}
      </article>
    );
  if (material.kind === "youtube")
    return <div className="video-material" ref={root} />;
  return (
    <div>
      <div className="button-row">
        <button disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
          上一頁
        </button>
        <span>
          第 {page}／{pages} 頁
        </span>
        <button disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>
          下一頁
        </button>
      </div>
      <canvas className="pdf-material" ref={canvas} />
    </div>
  );
}
