import { formatInZone } from "@/lib/dates"

export interface TimelineEntry {
  label: string
  /** ISO 8601, UTC. Shown in the merchant's timezone. */
  at: string
}

/** What happened to a record and when, oldest first, in the merchant's own time. */
export function Timeline({
  entries,
  timeZone,
}: {
  entries: TimelineEntry[]
  timeZone: string
}) {
  return (
    <ol className="mt-4 space-y-4">
      {entries.map((entry, index) => (
        <li key={index} className="flex gap-3">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm text-gray-900 dark:text-gray-50">{entry.label}</p>
            <p className="text-sm text-gray-500">{formatInZone(entry.at, timeZone)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
