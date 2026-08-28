import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sumMinorUnits } from "@/lib/money"
import { utcDayKey } from "@/lib/dates"
import { dailyVolume } from "./metrics"
import { store } from "./store"

/**
 * dailyVolume used to bucket by the server's local calendar, add floats in
 * major units, size refunds from the original charge on the charge's day,
 * and sum three currencies into one number. All four are silent on a UTC
 * host. These tests reconcile every bucket against the store, with the
 * process clock set to New York so the local-calendar version fails here
 * whatever the CI host is set to.
 */

const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = "America/New_York"
  // Assert the premise: Node ignores a runtime TZ change inside worker_threads.
  expect(new Date("2026-08-13T02:00:00.000Z").getHours()).toBe(22)
})
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe("dailyVolume", () => {
  const volume = dailyVolume(30)
  const days = new Set(volume.map((d) => d.date))
  const inWindow = (iso: string) => days.has(utcDayKey(iso))

  it("reconciles captured to the USD payments of each UTC day", () => {
    for (const day of volume) {
      const captured = store.payments.filter((p) => p.status === "captured" && p.currency === "USD" && utcDayKey(p.createdAt) === day.date)
      expect(day.captured).toBe(sumMinorUnits(captured.map((p) => p.amount)))
    }
    // Payments in the first four UTC hours are what New York's calendar puts on the previous day.
    expect(store.payments.some((p) => inWindow(p.createdAt) && p.createdAt.slice(11, 13) < "04")).toBe(true)
  })

  it("reconciles refunded to the refund records, on the refund's day", () => {
    for (const day of volume) {
      const refunds = store.refunds.filter((r) => r.currency === "USD" && utcDayKey(r.createdAt) === day.date)
      expect(day.refunded).toBe(sumMinorUnits(refunds.map((r) => r.amount)))
    }
    // At least one partial refund, so sizing from the original charge would differ.
    expect(store.refunds.some((r) => inWindow(r.createdAt) && r.amount < store.payments.find((p) => p.id === r.paymentId)!.amount)).toBe(true)
  })

  it("keeps other currencies out of the dollar series", () => {
    expect(volume.every((d) => d.currency === "USD")).toBe(true)
    const gbp = store.payments.filter((p) => p.status === "captured" && p.currency === "GBP" && inWindow(p.createdAt))
    expect(gbp.length).toBeGreaterThan(0)
    expect(sumMinorUnits(dailyVolume(30, "GBP").map((d) => d.captured))).toBe(sumMinorUnits(gbp.map((p) => p.amount)))
    expect(dailyVolume(7)).toHaveLength(7)
  })
})
