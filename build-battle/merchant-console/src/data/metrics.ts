import { lastUtcDays, utcDayKey } from "@/lib/dates"
import { GENERATED_AT } from "./generate"
import { store } from "./store"
import { Currency } from "./types"

/**
 * Dashboard metrics. Everything here is reported in USD minor units for the
 * headline figures, because the overview is an internal ops screen rather
 * than a merchant statement.
 */

export interface DailyVolume {
  date: string
  /** The one currency every amount in this row is in. */
  currency: Currency
  /** Integer minor units, like every other amount in the app. */
  captured: number
  /** Integer minor units, from the refund records, on the day they were made. */
  refunded: number
}

/**
 * Captured and refunded volume per UTC day, in one currency. Amounts in
 * other currencies are not added in: a EUR payment is not a number of
 * dollars, and the chart says "$".
 */
export function dailyVolume(days = 30, currency: Currency = "USD"): DailyVolume[] {
  const keys = lastUtcDays(days, GENERATED_AT)
  const buckets = new Map<string, DailyVolume>(
    keys.map((date) => [date, { date, currency, captured: 0, refunded: 0 }]),
  )

  // Bucket by the UTC day, the same calendar the keys above were built on.
  // The server's local calendar would move evening payments to the wrong
  // day for every merchant east or west of it. Integer minor units all the
  // way; nothing here needs to be rounded back.
  for (const payment of store.payments) {
    if (payment.status !== "captured" || payment.currency !== currency) continue
    const bucket = buckets.get(utcDayKey(payment.createdAt))
    if (bucket) bucket.captured += payment.amount
  }

  // Refunds come from the refund ledger: their own amount (a partial refund
  // is not the whole charge) on their own day (not the charge's day).
  for (const refund of store.refunds) {
    if (refund.currency !== currency) continue
    const bucket = buckets.get(utcDayKey(refund.createdAt))
    if (bucket) bucket.refunded += refund.amount
  }

  return keys.map((date) => buckets.get(date)!)
}

export function headlineMetrics() {
  const captured = store.payments.filter((p) => p.status === "captured")
  const refunded = store.payments.filter((p) => p.status === "refunded")

  // Gross volume is everything that moved through the platform.
  const grossVolume =
    captured.reduce((sum, p) => sum + p.amount, 0) +
    refunded.reduce((sum, p) => sum + p.amount, 0)

  const authorized = store.payments.filter(
    (p) => p.status !== "failed",
  ).length
  const authRate = store.payments.length
    ? authorized / store.payments.length
    : 0

  const openDisputes = store.disputes.filter(
    (d) => d.status === "needs_response" || d.status === "under_review",
  )

  return {
    grossVolume,
    authRate,
    paymentCount: store.payments.length,
    openDisputes: openDisputes.length,
    disputedAmount: openDisputes.reduce((sum, d) => sum + d.amount, 0),
  }
}
