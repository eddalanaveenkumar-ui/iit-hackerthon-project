import { useId, useState } from 'react';
import { Empty, Panel } from './shared';
import { cx } from '../../ui';

/**
 * `input` — a single controlled field, outside a form.
 *
 * Used when the lesson needs exactly one answer inline (a "try a value"
 * prompt next to a chart, for example). When there is more than one question,
 * the author should use `question_form` so the student gets one submit button.
 *
 * The field is genuinely controlled: the value lives in React state here, the
 * label is associated with the control, and help/error text is wired through
 * `aria-describedby`.
 */
export default function InputRenderer({ component }) {
  const id = useId();
  const [value, setValue] = useState(component.default_value ?? '');
  const options = (component.options || []).map((option, index) => ({ value: String(index), label: option }));

  const describedBy = [component.help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined;

  const control = () => {
    switch (component.input_type) {
      case 'textarea':
        return <textarea id={id} className="input min-h-[88px]" placeholder={component.placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} />;
      case 'radio':
      case 'select':
        if (!options.length) return null;
        return component.input_type === 'radio' ? (
          <div className="space-y-1.5" role="radiogroup" aria-labelledby={`${id}-label`}>
            {options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={id} className="h-4 w-4 accent-brand-600" checked={String(value) === option.value} onChange={() => setValue(option.value)} />
                {option.label}
              </label>
            ))}
          </div>
        ) : (
          <select id={id} className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy}>
            <option value="">Choose…</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      case 'checkbox_group':
        if (!options.length) return null;
        return (
          <div className="space-y-1.5">
            {options.map((option) => {
              const checked = Array.isArray(value) && value.includes(option.value);
              return (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={checked}
                    onChange={() =>
                      setValue((current) => {
                        const list = Array.isArray(current) ? current : [];
                        return checked ? list.filter((v) => v !== option.value) : [...list, option.value];
                      })
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        );
      case 'number':
        return <input id={id} type="number" className="input" placeholder={component.placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} />;
      case 'date':
        return <input id={id} type="date" className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} />;
      case 'boolean':
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={value === true || value === 'true'} onChange={(e) => setValue(e.target.checked)} />
            {component.placeholder || 'Yes'}
          </label>
        );
      case 'code_input':
        return (
          <textarea
            id={id}
            className="input min-h-[120px] font-mono text-[13px]"
            spellCheck={false}
            placeholder={component.placeholder || `Write ${component.language || 'code'}…`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={describedBy}
          />
        );
      case 'file_upload':
        return <p className="text-xs text-slate-500">File uploads are handled inside a question form, where size and type can be enforced for the whole submission.</p>;
      default:
        return <input id={id} type="text" className="input" placeholder={component.placeholder} value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={describedBy} />;
    }
  };

  const body = control();
  if (!body) {
    return (
      <Panel title={component.title} className={cx(component.style?.width === 'half' ? 'sm:w-1/2' : 'w-full')}>
        <Empty label="This field has no options to choose from." />
      </Panel>
    );
  }

  return (
    <Panel title={component.title} className={cx(component.style?.width === 'half' ? 'sm:w-1/2' : 'w-full')}>
      <div className="space-y-1.5">
        <label id={`${id}-label`} htmlFor={id} className="label mb-0">
          {component.label}
          {component.required ? <span className="ml-1 text-rose-500" aria-hidden>*</span> : null}
        </label>
        {body}
        {component.help ? (
          <p id={`${id}-help`} className="text-[11px] text-slate-500 dark:text-slate-400">
            {component.help}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
