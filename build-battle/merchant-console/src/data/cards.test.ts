import { describe, expect, it } from "vitest"
import { MAX_SPEND_LIMIT, isLuhnValid } from "@/lib/cards"
import { cardById, issueCard, listCards, parseIssueCardInput, transitionCard } from "./cards"
import { store } from "./store"
import { IssueCardInput } from "./types"

/**
 * The server is the only place a card is validated, numbered, or moved
 * between statuses. These tests are the ticket's rejection list and the
 * reveal-once rule, run against the real store.
 */

const valid: IssueCardInput = {
  nickname: "Ads account",
  merchantId: "mch_01",
  spendLimit: 25000,
  currency: "USD",
  category: "advertising",
}
const digits = () => 3

describe("parseIssueCardInput", () => {
  it("accepts a complete card, trims the nickname, defaults the category", () => {
    const parsed = parseIssueCardInput({ ...valid, nickname: "  Ads account " })
    expect(parsed.errors).toBeNull()
    expect(parsed.input?.nickname).toBe("Ads account")
    const { category: _omitted, ...rest } = valid
    expect(parseIssueCardInput(rest).input?.category).toBe("any")
    expect(parseIssueCardInput({ ...valid, spendLimit: MAX_SPEND_LIMIT }).errors).toBeNull()
  })

  it("rejects each case the ticket names, one message per field", () => {
    const cases: [Record<string, unknown>, keyof IssueCardInput, string][] = [
      [{ ...valid, merchantId: "" }, "merchantId", "Choose a merchant."],
      [{ ...valid, merchantId: "mch_99" }, "merchantId", "Choose a merchant."],
      [{ ...valid, spendLimit: 0 }, "spendLimit", "more than zero"],
      [{ ...valid, spendLimit: -100 }, "spendLimit", "more than zero"],
      [{ ...valid, spendLimit: MAX_SPEND_LIMIT + 1 }, "spendLimit", "above $50,000.00"],
      [{ ...valid, spendLimit: 250.5 }, "spendLimit", "like 250.00"],
      [{ ...valid, spendLimit: "250.00" }, "spendLimit", "like 250.00"],
      [{ ...valid, spendLimit: "$250" }, "spendLimit", "like 250.00"],
      [{ ...valid, currency: "JPY" }, "currency", "USD, EUR, or GBP"],
      [{ ...valid, currency: "usd" }, "currency", "USD, EUR, or GBP"],
      [{ ...valid, currency: 840 }, "currency", "USD, EUR, or GBP"],
      [{ ...valid, category: "weapons" }, "category", "from the list"],
      [{ ...valid, nickname: "   " }, "nickname", "nickname"],
      [{ ...valid, nickname: "x".repeat(41) }, "nickname", "40 characters"],
    ]
    for (const [body, field, message] of cases) {
      expect(parseIssueCardInput(body).errors?.[field], JSON.stringify(body)).toContain(message)
    }
  })

  it("rejects a currency the merchant does not settle in, and renders the ceiling in the card's currency", () => {
    // Brandt & Sohn is a Berlin merchant on EUR.
    expect(parseIssueCardInput({ ...valid, merchantId: "mch_05", currency: "USD" }).errors?.currency).toContain("settles in EUR")
    expect(parseIssueCardInput({ ...valid, merchantId: "mch_05", currency: "EUR" }).errors).toBeNull()
    const over = parseIssueCardInput({ ...valid, merchantId: "mch_05", currency: "EUR", spendLimit: MAX_SPEND_LIMIT + 1 })
    expect(over.errors?.spendLimit).toBe("The limit cannot be above €50,000.00.")
  })

  it("names every broken field at once, and survives garbage", () => {
    const parsed = parseIssueCardInput({ spendLimit: -1, currency: "XXX" })
    expect(Object.keys(parsed.errors ?? {}).sort()).toEqual(["currency", "merchantId", "nickname", "spendLimit"])
    expect(parseIssueCardInput(null).errors).not.toBeNull()
    expect(parseIssueCardInput("string").errors).not.toBeNull()
  })
})

describe("issueCard", () => {
  it("returns the full number once and stores only the last four", () => {
    const before = listCards().length
    const result = issueCard(valid, { randomDigit: digits, now: new Date("2026-08-14T09:00:00.000Z") })
    expect(result.kind).toBe("issued")
    if (result.kind !== "issued") return
    expect(result.number).toMatch(/^4242\d{12}$/)
    expect(isLuhnValid(result.number)).toBe(true)
    expect(result.card.last4).toBe(result.number.slice(-4))
    expect(result.card.numberRef).toMatch(/^pan_/)
    expect(JSON.stringify(result.card)).not.toContain(result.number)
    expect(result.card).toMatchObject({ status: "active", spent: 0, createdAt: "2026-08-14T09:00:00.000Z" })
    expect(result.card.history).toEqual([{ type: "issued", at: "2026-08-14T09:00:00.000Z" }])
    expect(listCards()).toHaveLength(before + 1)
    expect(cardById(result.card.id)).toBe(result.card)
    expect(listCards()[0].id).toBe(result.card.id)
  })

  it("replays the same key without the number, and refuses the same key with a different body", () => {
    const before = listCards().length
    const first = issueCard(valid, { idempotencyKey: "req-1", randomDigit: digits })
    const again = issueCard(valid, { idempotencyKey: "req-1", randomDigit: digits })
    expect(again.kind).toBe("replayed")
    expect(again.card.id).toBe(first.card.id)
    expect(again).not.toHaveProperty("number")

    const edited = issueCard({ ...valid, spendLimit: 99900 }, { idempotencyKey: "req-1", randomDigit: digits })
    expect(edited.kind).toBe("conflict")
    expect(edited).not.toHaveProperty("number")

    const other = issueCard(valid, { idempotencyKey: "req-2", randomDigit: digits })
    expect(other.card.id).not.toBe(first.card.id)
    expect(store.cardIssueKeys.get("req-2")?.cardId).toBe(other.card.id)
    expect(listCards()).toHaveLength(before + 2)
  })
})

describe("transitionCard", () => {
  const issue = () => issueCard({ ...valid, nickname: "Transitions" }, { randomDigit: digits }).card

  it("walks active → frozen → active → cancelled, recording each step, then refuses everything", () => {
    const card = issue()
    expect(transitionCard(card.id, "freeze", new Date("2026-08-20T10:00:00.000Z")).card?.status).toBe("frozen")
    expect(transitionCard(card.id, "unfreeze", new Date("2026-08-21T10:00:00.000Z")).card?.status).toBe("active")
    expect(transitionCard(card.id, "cancel").card?.status).toBe("cancelled")
    for (const action of ["freeze", "unfreeze", "cancel"] as const) {
      expect(transitionCard(card.id, action).error).toBe("illegal")
    }
    expect(card.status).toBe("cancelled")
    expect(card.history.map((e) => e.type)).toEqual(["issued", "frozen", "unfrozen", "cancelled"])
    expect(card.history[2].at).toBe("2026-08-21T10:00:00.000Z")
  })

  it("refuses a move the machine does not have, leaves the card alone, and reports an unknown card", () => {
    const card = issue()
    expect(transitionCard(card.id, "unfreeze").error).toBe("illegal")
    expect(card.status).toBe("active")
    expect(card.history).toHaveLength(1)
    expect(transitionCard("card_nope", "freeze").error).toBe("not_found")
  })
})
