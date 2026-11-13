import { useId } from 'react';
import { Body, Panel, WIDTH_CLASS } from './shared';
import { cx } from '../../ui';

/**
 * `text` — a prose section.
 *
 * The workhorse component: definitions, explanations, summaries. Rendered as
 * markdown through the sanitising renderer; `format: "plain"` keeps the author's
 * line breaks without interpreting markdown at all.
 */
export default function TextRenderer({ component }) {
  const id = useId();
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const align = component.style?.align === 'center' ? 'text-center' : component.style?.align === 'right' ? 'text-right' : '';
  const emphasis = component.style?.emphasis === 'high' ? 'border-l-2 border-l-brand-500' : '';

  // Unstyled prose: a lesson's main narrative should not look like a stack of
  // cards. A title (when present) makes it a section.
  if (!component.title) {
    return (
      <div className={cx(width, align)}>
        <Body format={component.format}>{component.content}</Body>
      </div>
    );
  }

  return (
    <Panel
      title={component.title}
      tone={component.style?.tone || 'neutral'}
      className={cx(width, emphasis)}
      titleId={id}
    >
      <div className={align}>
        <Body format={component.format}>{component.content}</Body>
      </div>
    </Panel>
  );
}
