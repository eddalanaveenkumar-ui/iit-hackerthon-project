import { Body, Empty, Icon, Panel, WIDTH_CLASS } from './shared';

/**
 * `card` — a short, framed idea.
 *
 * Used for definitions, key terms, warnings and callouts. A card may contain
 * child components (a code snippet inside a definition, for example), which is
 * why it is a container in the registry.
 */
export default function CardRenderer({ component, depth, renderChildren }) {
  const children = component.children || [];
  const width = WIDTH_CLASS[component.style?.width] || 'w-full';
  const tone = component.style?.tone || 'neutral';
  const hasBody = Boolean(component.body);

  if (!hasBody && !children.length && !component.title) {
    return (
      <div className={width}>
        <Empty label="This card has no content." />
      </div>
    );
  }

  return (
    <Panel
      title={component.title}
      subtitle={component.subtitle}
      icon={component.icon || component.style?.icon}
      tone={tone}
      className={width}
      footer={component.footer}
    >
      <div className="space-y-3">
        {hasBody ? <Body>{component.body}</Body> : null}
        {children.length && renderChildren ? renderChildren(children, depth + 1) : null}
      </div>
    </Panel>
  );
}

/** Exported for tests: a card without content must not produce an empty frame. */
export const CARD_EMPTY_LABEL = 'This card has no content.';
export { Icon };
