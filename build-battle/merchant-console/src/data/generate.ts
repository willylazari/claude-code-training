import { generateCardNumber, lastFour } from "@/lib/cards"
import { merchants } from "./merchants"
import {
  Card,
  CardCategory,
  CardStatus,
  Currency,
  Dispute,
  Payment,
  PaymentStatus,
  Payout,
  Refund,
} from "./types"

/**
 * Deterministic seed data. Everyone in the room gets identical records,
 * so a bug reproduces the same way on every machine.
 */

const SEED = 20260813
const DAYS = 120
const PAYMENTS_PER_DAY = 14

/** Small, fast, deterministic PRNG. Not for anything that matters. */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)]
const between = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min

const DESCRIPTIONS = [
  "Online order",
  "In-store purchase",
  "Subscription renewal",
  "Gift card",
  "Wholesale invoice",
  "Repeat order",
  "Marketplace order",
]

const REASON_CODES = [
  "10.4 Other Fraud",
  "12.6 Duplicate Processing",
  "13.1 Merchandise Not Received",
  "13.3 Not as Described",
  "13.7 Cancelled Merchandise",
]

const pad = (n: number, width = 6) => String(n).padStart(width, "0")

/** The anchor date. Fixed, so "the last 30 days" is stable across runs. */
export const GENERATED_AT = new Date("2026-08-13T00:00:00.000Z")

function statusFor(): PaymentStatus {
  const roll = rand()
  if (roll < 0.78) return "captured"
  if (roll < 0.86) return "authorized"
  if (roll < 0.93) return "refunded"
  if (roll < 0.98) return "failed"
  return "disputed"
}

export function generate() {
  const payments: Payment[] = []
  const refunds: Refund[] = []
  const disputes: Dispute[] = []
  let paymentSeq = 0
  let refundSeq = 0
  let disputeSeq = 0

  for (let day = DAYS - 1; day >= 0; day--) {
    const dayStart = new Date(GENERATED_AT)
    dayStart.setUTCDate(dayStart.getUTCDate() - day)

    const count = between(PAYMENTS_PER_DAY - 5, PAYMENTS_PER_DAY + 5)

    for (let i = 0; i < count; i++) {
      const merchant = pick(merchants)
      const createdAt = new Date(dayStart)
      createdAt.setUTCHours(between(0, 23), between(0, 59), between(0, 59), 0)

      const status = statusFor()
      const method = rand() < 0.82 ? "card" : rand() < 0.6 ? "wallet" : "bank_transfer"
      const amount = between(450, 480_00)

      const payment: Payment = {
        id: `pay_${pad(++paymentSeq)}`,
        merchantId: merchant.id,
        amount,
        currency: merchant.currency as Currency,
        status,
        method,
        cardBrand:
          method === "card" ? pick(["visa", "mastercard", "amex"] as const) : null,
        last4: method === "card" ? String(between(1000, 9999)) : null,
        createdAt: createdAt.toISOString(),
        description: pick(DESCRIPTIONS),
      }
      payments.push(payment)

      if (status === "refunded") {
        const full = rand() < 0.7
        refunds.push({
          id: `re_${pad(++refundSeq)}`,
          paymentId: payment.id,
          amount: full ? amount : Math.floor(amount / 2),
          currency: payment.currency,
          reason: pick([
            "requested_by_customer",
            "duplicate",
            "fraudulent",
          ] as const),
          createdAt: new Date(
            createdAt.getTime() + between(1, 6) * 86_400_000,
          ).toISOString(),
        })
      }

      if (status === "disputed") {
        const openedAt = new Date(createdAt.getTime() + between(2, 10) * 86_400_000)
        disputes.push({
          id: `dp_${pad(++disputeSeq)}`,
          paymentId: payment.id,
          merchantId: merchant.id,
          amount,
          currency: payment.currency,
          reasonCode: pick(REASON_CODES),
          status: pick([
            "needs_response",
            "needs_response",
            "under_review",
            "won",
            "lost",
          ] as const),
          openedAt: openedAt.toISOString(),
          evidenceDueAt: new Date(
            openedAt.getTime() + 14 * 86_400_000,
          ).toISOString(),
        })
      }
    }
  }

  const payouts = generatePayouts(payments)
  // Cards draw from the PRNG after everything else, so adding them changed
  // no payment, refund, dispute, or payout that was already seeded.
  const cards = generateCards()
  return { payments, refunds, disputes, payouts, cards }
}

/**
 * A handful of issued cards, so the list is not empty on day one and the
 * spend bar has something to show. Numbers come from the same generator the
 * server uses, on the test BIN; only the last four is kept, like everywhere.
 */
function generateCards(): Card[] {
  const seeds: {
    merchantId: string
    nickname: string
    category: CardCategory
    limit: number
    spentPercent: number
    status: CardStatus
    daysAgo: number
  }[] = [
    { merchantId: "mch_01", nickname: "Google Ads", category: "advertising", limit: 250000, spentPercent: 86, status: "active", daysAgo: 41 },
    { merchantId: "mch_02", nickname: "Trail crew contractors", category: "contractors", limit: 120000, spentPercent: 35, status: "active", daysAgo: 33 },
    { merchantId: "mch_04", nickname: "Adobe seats", category: "software", limit: 60000, spentPercent: 100, status: "frozen", daysAgo: 27 },
    { merchantId: "mch_05", nickname: "Messe travel", category: "travel", limit: 300000, spentPercent: 12, status: "active", daysAgo: 19 },
    { merchantId: "mch_07", nickname: "Old Zoom plan", category: "software", limit: 15000, spentPercent: 60, status: "cancelled", daysAgo: 58 },
    { merchantId: "mch_08", nickname: "Office supplies", category: "office", limit: 40000, spentPercent: 0, status: "active", daysAgo: 3 },
  ]

  const randomDigit = () => Math.floor(rand() * 10)

  return seeds.map((seed, index) => {
    const merchant = merchants.find((m) => m.id === seed.merchantId)!
    const issuedAt = new Date(GENERATED_AT)
    issuedAt.setUTCDate(issuedAt.getUTCDate() - seed.daysAgo)
    issuedAt.setUTCHours(between(8, 18), between(0, 59), 0, 0)
    const issued = issuedAt.toISOString()

    const history: Card["history"] = [{ type: "issued", at: issued }]
    if (seed.status !== "active") {
      const changedAt = new Date(issuedAt.getTime() + between(2, 14) * 86_400_000)
      history.push({ type: seed.status, at: changedAt.toISOString() })
    }

    const number = generateCardNumber(randomDigit)
    return {
      id: `card_${pad(index + 1)}`,
      merchantId: merchant.id,
      nickname: seed.nickname,
      last4: lastFour(number),
      numberRef: `pan_seed_${pad(index + 1, 4)}`,
      spendLimit: seed.limit,
      // Integer minor units: percent of an integer limit, floored.
      spent: Math.floor((seed.limit * seed.spentPercent) / 100),
      currency: merchant.currency as Currency,
      category: seed.category,
      status: seed.status,
      createdAt: issued,
      history,
    }
  })
}

function generatePayouts(payments: Payment[]): Payout[] {
  const payouts: Payout[] = []
  let seq = 0

  for (const merchant of merchants) {
    for (let week = 0; week < 8; week++) {
      const periodEnd = new Date(GENERATED_AT)
      periodEnd.setUTCDate(periodEnd.getUTCDate() - week * 7)
      const periodStart = new Date(periodEnd)
      periodStart.setUTCDate(periodStart.getUTCDate() - 7)

      const inPeriod = payments.filter(
        (p) =>
          p.merchantId === merchant.id &&
          p.status === "captured" &&
          p.createdAt >= periodStart.toISOString() &&
          p.createdAt < periodEnd.toISOString(),
      )
      if (inPeriod.length === 0) continue

      const gross = inPeriod.reduce((sum, p) => sum + p.amount, 0)
      const fees = Math.round(gross * 0.029) + inPeriod.length * 30

      payouts.push({
        id: `po_${pad(++seq, 4)}`,
        merchantId: merchant.id,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        gross,
        fees,
        net: gross - fees,
        currency: merchant.currency,
        status: week === 0 ? "pending" : week === 1 ? "in_transit" : "paid",
        paymentIds: inPeriod.map((p) => p.id),
      })
    }
  }

  return payouts
}
