import { CardCategory, CardStatus, Currency } from "@/data/types"

/**
 * Card numbers, card status, and the card allowlists, with no state and no
 * I/O, so the server and the form read the same definitions.
 *
 * Every number generated here starts with the 4242 test BIN and carries a
 * valid Luhn check digit, so nothing in this repository can resemble a real
 * card. Generation takes its digits from a caller-supplied source: the route
 * passes a cryptographic one, the seed passes its deterministic PRNG, tests
 * pass whatever they need.
 */

export const TEST_BIN = "4242"
export const CARD_NUMBER_LENGTH = 16

export const CURRENCIES: readonly Currency[] = ["USD", "EUR", "GBP"]

export const CARD_CATEGORIES: readonly CardCategory[] = [
  "any",
  "software",
  "advertising",
  "travel",
  "office",
  "contractors",
]

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  any: "Any category",
  software: "Software and SaaS",
  advertising: "Advertising",
  travel: "Travel",
  office: "Office supplies",
  contractors: "Contractors",
}

/** From the ticket: a limit above 5,000,000 minor units is rejected. */
export const MAX_SPEND_LIMIT = 5_000_000
export const MAX_NICKNAME_LENGTH = 40

/** An Idempotency-Key is client input too: short, printable, no spaces. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128
export function isIdempotencyKey(value: string): boolean {
  return value.length <= MAX_IDEMPOTENCY_KEY_LENGTH && /^[\x21-\x7e]+$/.test(value)
}

/** A function returning one digit, 0 through 9. */
export type RandomDigit = () => number

function luhnSum(digits: string, doubleFromRight: boolean): number {
  let sum = 0
  let double = doubleFromRight
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum
}

/** The digit that makes `partial + digit` pass Luhn. */
export function luhnCheckDigit(partial: string): number {
  if (!/^\d+$/.test(partial)) throw new Error("Luhn needs digits only")
  return (10 - (luhnSum(partial, true) % 10)) % 10
}

export function isLuhnValid(number: string): boolean {
  if (!/^\d{2,}$/.test(number)) return false
  return luhnSum(number, false) % 10 === 0
}

/** A 16-digit number on the test BIN with a valid check digit. */
export function generateCardNumber(randomDigit: RandomDigit): string {
  let partial = TEST_BIN
  while (partial.length < CARD_NUMBER_LENGTH - 1) {
    const digit = randomDigit()
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      throw new Error("randomDigit must return an integer 0 through 9")
    }
    partial += String(digit)
  }
  return partial + String(luhnCheckDigit(partial))
}

export function lastFour(number: string): string {
  return number.slice(-4)
}

/** How a card number appears anywhere except the one-time reveal. */
export function maskCardNumber(last4: string): string {
  return `•••• ${last4}`
}

/** The reveal screen shows the number in groups of four. Display only. */
export function groupCardNumber(number: string): string {
  return number.replace(/(\d{4})(?=\d)/g, "$1 ")
}

/**
 * Status is a state machine: active ⇄ frozen, either → cancelled, and
 * cancelled is terminal. The table is the single source of truth; the
 * server guards with it and the UI reads it to decide which buttons exist.
 */

export type CardAction = "freeze" | "unfreeze" | "cancel"

export const CARD_ACTIONS: readonly CardAction[] = ["freeze", "unfreeze", "cancel"]

export const CARD_TRANSITIONS: Record<
  CardStatus,
  Partial<Record<CardAction, CardStatus>>
> = {
  active: { freeze: "frozen", cancel: "cancelled" },
  frozen: { unfreeze: "active", cancel: "cancelled" },
  cancelled: {},
}

/** The status an action leads to from `from`, or null when it is not allowed. */
export function nextCardStatus(
  from: CardStatus,
  action: CardAction,
): CardStatus | null {
  return CARD_TRANSITIONS[from][action] ?? null
}

/** The actions available from a status, in display order. */
export function availableCardActions(from: CardStatus): CardAction[] {
  return CARD_ACTIONS.filter((action) => nextCardStatus(from, action) !== null)
}

/**
 * Spend as a whole-number percentage of the limit. Integer arithmetic on
 * minor units; floored so 79.9% never reads as 80.
 */
export function spendPercent(spent: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.floor((spent * 100) / limit)
}
