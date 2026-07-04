type ReportPitchInsightListProps = Readonly<{
  title: string;
  items: string[];
  tone: "emerald" | "amber" | "blue";
}>;

const toneClasses = {
  emerald: {
    container: "border-emerald-100 bg-emerald-50/50",
    title: "text-emerald-800",
    item: "text-emerald-700/80",
    dot: "bg-emerald-400",
  },
  amber: {
    container: "border-amber-100 bg-amber-50/50",
    title: "text-amber-800",
    item: "text-amber-700/80",
    dot: "bg-amber-400",
  },
  blue: {
    container: "border-blue-100 bg-blue-50/50",
    title: "text-blue-800",
    item: "text-blue-700/80",
    dot: "bg-blue-400",
  },
} as const;

export function ReportPitchInsightList({
  title,
  items,
  tone,
}: ReportPitchInsightListProps) {
  if (items.length === 0) return null;

  const classes = toneClasses[tone];

  return (
    <div className={`rounded-md border p-4 ${classes.container}`}>
      <h4 className={`text-sm font-semibold ${classes.title}`}>{title}</h4>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={index} className={`flex gap-2 text-sm leading-6 ${classes.item}`}>
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${classes.dot}`}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
