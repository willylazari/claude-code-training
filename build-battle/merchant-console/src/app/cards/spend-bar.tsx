import { Currency } from "@/data/types"
import { spendPercent } from "@/lib/cards"
import { formatMoney } from "@/lib/money"
import { cx } from "@/lib/utils"

/**
 * Spend against the limit. Integer minor units in, one formatted string
 * per amount out. Amber from 80%, red at the limit. A native progress
 * element, so it needs no inline style and reads correctly to a screen reader.
 */
export function SpendBar({
  spent,
  limit,
  currency,
}: {
  spent: number
  limit: number
  currency: Currency
}) {
  const percent = spendPercent(spent, limit)
  const shown = Math.min(percent, 100)
  const hot = percent >= 80
  const over = percent >= 100

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-gray-900 dark:text-gray-50">
          <span className="font-medium tabular-nums">{formatMoney(spent, currency)}</span>
          <span className="text-gray-500"> of {formatMoney(limit, currency)}</span>
        </span>
        <span
          className={cx(
            "tabular-nums",
            over
              ? "font-medium text-red-600 dark:text-red-500"
              : hot
                ? "font-medium text-amber-600 dark:text-amber-500"
                : "text-gray-500",
          )}
        >
          {percent}%
        </span>
      </div>
      <progress
        value={shown}
        max={100}
        aria-label={`${percent}% of the spend limit used`}
        className={cx(
          "mt-2 h-2 w-full appearance-none overflow-hidden rounded-full",
          "bg-gray-200 dark:bg-gray-800",
          "[&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-gray-200 dark:[&::-webkit-progress-bar]:bg-gray-800",
          "[&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:rounded-full",
          over
            ? "[&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500"
            : hot
              ? "[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500"
              : "[&::-webkit-progress-value]:bg-blue-500 [&::-moz-progress-bar]:bg-blue-500",
        )}
      />
      {hot && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
          {over ? "At the limit. Nothing more goes through on this card." : "Past 80% of the limit."}
        </p>
      )}
    </div>
  )
}
