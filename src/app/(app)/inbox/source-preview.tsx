"use client";

export function SourcePreview({
  text,
  fragments,
}: {
  text: string;
  fragments: Array<{ startOffset: number; endOffset: number; text: string }>;
}) {
  const marks = fragments.filter((row) => row.startOffset >= 0 && row.endOffset > row.startOffset);
  const points = new Set<number>([0, text.length]);
  for (const mark of marks) {
    points.add(mark.startOffset);
    points.add(Math.min(mark.endOffset, text.length));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const locators = marks.filter((row) => /!|第\d+页/.test(row.text));

  return (
    <div className="mt-2 space-y-2">
      <p className="whitespace-pre-wrap rounded-lg bg-[var(--paper)] p-3 text-sm leading-7">
        {sorted.slice(0, -1).map((start, index) => {
          const end = sorted[index + 1] ?? start;
          const value = text.slice(start, end);
          const highlighted = marks.some((mark) => mark.startOffset <= start && mark.endOffset >= end && start < end);
          const hasAnchor = marks.some((mark) => mark.startOffset === start);
          const content = highlighted ? (
            <mark className="rounded-sm bg-[var(--brand-soft)] px-0.5 text-[var(--ink)]">{value}</mark>
          ) : (
            value
          );
          return hasAnchor ? (
            <span key={`s-${start}`} id={`loc-${start}`}>
              {content}
            </span>
          ) : (
            <span key={`s-${start}`}>{content}</span>
          );
        })}
      </p>
      {locators.length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {locators.map((row) => (
            <a
              key={row.startOffset}
              href={`#loc-${row.startOffset}`}
              className="rounded-lg border border-[var(--line)] px-2 py-1 text-[var(--brand-strong)]"
            >
              {row.text.split("\t")[0]}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
