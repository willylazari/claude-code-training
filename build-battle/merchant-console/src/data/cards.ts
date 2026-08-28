import {
  CARD_CATEGORIES,
  CURRENCIES,
  CardAction,
  MAX_NICKNAME_LENGTH,
  MAX_SPEND_LIMIT,
  generateCardNumber,
  lastFour,
  nextCardStatus,
} from "@/lib/cards"
import { formatMoney } from "@/lib/money"
import { randomInt, randomUUID } from "node:crypto"
import { merchantById } from "./merchants"
import { store } from "./store"
import {
  Card,
  CardCategory,
  CardEventType,
  CardStatus,
  Currency,
  IssueCardInput,
} from "./types"

/**
 * Cards in the store: validation, issue, lookup, and status changes.
 *
 * Anything from the client comes through parseIssueCardInput before it
 * reaches the store. The full card number is produced here, returned once,
 * and never kept: the record carries the last four and an opaque reference.
 */

export type IssueCardErrors = Partial<Record<keyof IssueCardInput, string>>

export type ParsedIssueCard =
  | { input: IssueCardInput; errors: null }
  | { input: null; errors: IssueCardErrors }

function field(body: Record<string, unknown>, name: string): unknown {
  return Object.prototype.hasOwnProperty.call(body, name) ? body[name] : undefined
}

/**
 * Turn an untrusted JSON body into IssueCardInput, or into one message per
 * field that is wrong. Every check the ticket names lives here, plus the one
 * the codebase knows about: a merchant settles in one currency.
 */
export function parseIssueCardInput(raw: unknown): ParsedIssueCard {
  const errors: IssueCardErrors = {}
  const body =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}

  const nickname =
    typeof field(body, "nickname") === "string"
      ? (field(body, "nickname") as string).trim()
      : ""
  if (nickname.length === 0) errors.nickname = "Give the card a nickname."
  else if (nickname.length > MAX_NICKNAME_LENGTH)
    errors.nickname = `Keep the nickname to ${MAX_NICKNAME_LENGTH} characters.`

  const merchantId =
    typeof field(body, "merchantId") === "string"
      ? (field(body, "merchantId") as string)
      : ""
  const merchant = merchantId ? merchantById(merchantId) : undefined
  if (!merchant) errors.merchantId = "Choose a merchant."

  const currency = field(body, "currency")
  const currencyIsKnown =
    typeof currency === "string" && CURRENCIES.includes(currency as Currency)
  if (!currencyIsKnown) {
    errors.currency = "Choose USD, EUR, or GBP."
  } else if (merchant && merchant.currency !== currency) {
    errors.currency = `${merchant.name} settles in ${merchant.currency}. Choose ${merchant.currency} or a different merchant.`
  }

  const spendLimit = field(body, "spendLimit")
  if (typeof spendLimit !== "number" || !Number.isInteger(spendLimit)) {
    errors.spendLimit = "Enter the limit as an amount, like 250.00."
  } else if (spendLimit <= 0) {
    errors.spendLimit = "The limit has to be more than zero."
  } else if (spendLimit > MAX_SPEND_LIMIT) {
    // The ceiling is one constant; the message renders it rather than
    // repeating it, in the currency the card would have had.
    const shownIn = merchant?.currency ?? (currencyIsKnown ? (currency as Currency) : "USD")
    errors.spendLimit = `The limit cannot be above ${formatMoney(MAX_SPEND_LIMIT, shownIn)}.`
  }

  const category = field(body, "category") ?? "any"
  if (
    typeof category !== "string" ||
    !CARD_CATEGORIES.includes(category as CardCategory)
  ) {
    errors.category = "Choose a category from the list."
  }

  if (Object.keys(errors).length > 0) return { input: null, errors }

  return {
    input: {
      nickname,
      merchantId,
      spendLimit: spendLimit as number,
      currency: currency as Currency,
      category: category as CardCategory,
    },
    errors: null,
  }
}

/** Newest first, the way ops looks for the one they just made. */
export function listCards(): Card[] {
  return [...store.cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function cardById(id: string): Card | null {
  return store.cards.find((card) => card.id === id) ?? null
}

function nextCardId(): string {
  return `card_${String(store.cards.length + 1).padStart(6, "0")}`
}

/** One digit from the OS's CSPRNG. Only the server ever generates a number. */
export function secureRandomDigit(): number {
  return randomInt(10)
}

/** What an idempotency key is bound to: the same key must mean the same card. */
function fingerprint(input: IssueCardInput): string {
  return JSON.stringify([
    input.merchantId,
    input.nickname,
    input.spendLimit,
    input.currency,
    input.category,
  ])
}

export type IssueResult =
  /** A new card. This is the only place the full number ever appears. */
  | { kind: "issued"; card: Card; number: string }
  /** The same request again: the card it made, without the number. */
  | { kind: "replayed"; card: Card }
  /** The same key with a different body: refused, nothing created. */
  | { kind: "conflict"; card: Card }

/**
 * Create a card. The full number is generated here and returned once; the
 * record keeps the last four and a reference. An idempotency key makes a
 * double-submitted form return the card it already made, without the number,
 * because the reveal happened the first time. The same key with different
 * input is a conflict, not a silent success.
 */
export function issueCard(
  input: IssueCardInput,
  options: {
    idempotencyKey?: string
    now?: Date
    randomDigit?: () => number
  } = {},
): IssueResult {
  const key = options.idempotencyKey?.trim()
  const print = fingerprint(input)
  if (key) {
    const seen = store.cardIssueKeys.get(key)
    const existing = seen ? cardById(seen.cardId) : null
    if (existing) {
      return seen!.fingerprint === print
        ? { kind: "replayed", card: existing }
        : { kind: "conflict", card: existing }
    }
  }

  const number = generateCardNumber(options.randomDigit ?? secureRandomDigit)
  const at = (options.now ?? new Date()).toISOString()
  const card: Card = {
    id: nextCardId(),
    merchantId: input.merchantId,
    nickname: input.nickname,
    last4: lastFour(number),
    numberRef: `pan_${randomUUID()}`,
    spendLimit: input.spendLimit,
    spent: 0,
    currency: input.currency,
    category: input.category,
    status: "active",
    createdAt: at,
    history: [{ type: "issued", at }],
  }
  store.cards.push(card)
  if (key) store.cardIssueKeys.set(key, { cardId: card.id, fingerprint: print })

  return { kind: "issued", card, number }
}

const EVENT_FOR_STATUS: Record<Exclude<CardStatus, "active">, CardEventType> = {
  frozen: "frozen",
  cancelled: "cancelled",
}

export type TransitionResult =
  | { card: Card; error: null }
  | { card: null; error: "not_found" }
  | { card: null; error: "illegal"; from: CardStatus; action: CardAction }

/** Apply an action if the state machine allows it. The server guards here. */
export function transitionCard(
  id: string,
  action: CardAction,
  now: Date = new Date(),
): TransitionResult {
  const card = cardById(id)
  if (!card) return { card: null, error: "not_found" }

  const to = nextCardStatus(card.status, action)
  if (!to) return { card: null, error: "illegal", from: card.status, action }

  card.status = to
  card.history.push({
    type: to === "active" ? "unfrozen" : EVENT_FOR_STATUS[to],
    at: now.toISOString(),
  })
  return { card, error: null }
}

/** A sentence for a refused action, safe to show to a user. */
export function describeIllegalTransition(from: CardStatus, action: CardAction): string {
  if (from === "cancelled") return "This card is cancelled. Nothing can bring it back."
  if (action === "unfreeze") return "This card is not frozen."
  if (action === "freeze") return "This card is already frozen."
  return `A ${from} card cannot be ${action}led.`
}
