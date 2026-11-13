import { useState } from 'react';
import { ImageOff, Pause, Play } from 'lucide-react';
import { sanitizeUrl } from '../utils/validateUI';
import { Empty, Notice, Panel, WIDTH_CLASS } from './shared';

/**
 * `media` — an image, video or audio block.
 *
 * The URL has already been validated by the schema (https, or a small inline
 * raster data URI; SVG is refused). It is re-checked here because a renderer
 * must not rely on its caller, and the fallback is a visible "not available"
 * state rather than a broken image icon.
 *
 * Videos never autoplay and always carry controls: a lesson that starts playing
 * audio when it loads is a bug, not a feature.
 */
export default function MediaRenderer({ component }) {
  const src = sanitizeUrl(component.src);
  const poster = component.poster ? sanitizeUrl(component.poster) : '';
  const [failed, setFailed] = useState(false);
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';

  if (!src) {
    return (
      <div className={width}>
        <Notice>This {component.media_kind} could not be shown — the source failed the safety check (https only).</Notice>
      </div>
    );
  }

  const caption = component.caption ? <p className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">{component.caption}</p> : null;

  return (
    <Panel title={component.title} className={width}>
      {failed ? (
        <Empty label="This media could not be loaded." icon={ImageOff} />
      ) : component.media_kind === 'image' ? (
        <figure>
          <img
            src={src}
            alt={component.alt || component.title || 'Lesson illustration'}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="mx-auto max-h-[420px] w-auto max-w-full rounded-lg object-contain"
          />
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
      ) : component.media_kind === 'video' ? (
        <figure>
          <video
            src={src}
            poster={poster || undefined}
            controls
            preload="metadata"
            playsInline
            onError={() => setFailed(true)}
            className="w-full rounded-lg bg-black"
          >
            <track kind="captions" />
          </video>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <Play className="h-3 w-3" aria-hidden /> / <Pause className="h-3 w-3" aria-hidden /> press play — media never autoplays
          </p>
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
      ) : (
        <figure>
          <audio src={src} controls preload="none" onError={() => setFailed(true)} className="w-full">
            <track kind="captions" />
          </audio>
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
      )}
    </Panel>
  );
}
