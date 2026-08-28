import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import {
  CARD_TRANSITIONS,
  generateCardNumber,
  isLuhnValid,
  luhnCheckDigit,
} from "@/lib/cards"
import { POST as STATUS } from "./[id]/status/route"
import { GET, POST } from "./route"

/**
 * The route is the boundary the ticket cares about: what the client sends
 * is validated here, the number leaves here once, and the state machine is
 * enforced here. These tests call the handlers the way Next does, with a
 * real NextRequest, against the real store.
 */

const valid = {
  nickname: "Route test",
  merchantId: "mch_01",
  spendLimit: 25000,
  currency: "USD",
  category: "software",
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )
}

function status(id: string, action: unknown) {
  return STATUS(
    new NextRequest(`http://localhost/api/cards/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe("POST /api/cards", () => {
  it("issues a card and returns the number exactly once", async () => {
    const response = await post(valid, { "idempotency-key": "route-1" })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.number).toMatch(/^4242\d{12}$/)
    expect(isLuhnValid(body.number)).toBe(true)
    expect(body.card.last4).toBe(body.number.slice(-4))
    expect(body.card).not.toHaveProperty("number")

    const list = await (await GET()).json()
    expect(JSON.stringify(list)).not.toContain(body.number)
    expect(list.cards.some((c: { id: string }) => c.id === body.card.id)).toBe(true)
  })

  it("replays the same request without the number, and refuses a changed one", async () => {
    const first = await (await post(valid, { "idempotency-key": "route-2" })).json()

    const replay = await post(valid, { "idempotency-key": "route-2" })
    expect(replay.status).toBe(200)
    const replayed = await replay.json()
    expect(replayed.replayed).toBe(true)
    expect(replayed.card.id).toBe(first.card.id)
    expect(replayed).not.toHaveProperty("number")

    const changed = await post({ ...valid, spendLimit: 99900 }, { "idempotency-key": "route-2" })
    expect(changed.status).toBe(409)
  })

  it("bounds the idempotency key like any other client input", async () => {
    expect((await post(valid, { "idempotency-key": "x".repeat(129) })).status).toBe(400)
    expect((await post(valid, { "idempotency-key": "has space" })).status).toBe(400)
  })

  it("rejects each case the ticket names, naming the field", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ ...valid, merchantId: "" }, "merchantId", "Choose a merchant."],
      [{ ...valid, spendLimit: 0 }, "spendLimit", "more than zero"],
      [{ ...valid, spendLimit: -1 }, "spendLimit", "more than zero"],
      [{ ...valid, spendLimit: 5_000_001 }, "spendLimit", "above $50,000.00"],
      [{ ...valid, spendLimit: "250.00" }, "spendLimit", "like 250.00"],
      [{ ...valid, currency: "JPY" }, "currency", "USD, EUR, or GBP"],
      // The codebase knows Brandt & Sohn settles in EUR; the server, not the form, refuses a USD card for them.
      [{ ...valid, merchantId: "mch_05", currency: "USD" }, "currency", "settles in EUR"],
    ]
    for (const [body, field, message] of cases) {
      const response = await post(body)
      expect(response.status).toBe(400)
      const json = await response.json()
      expect(json.fields[field]).toContain(message)
    }
    expect((await post({ ...valid, merchantId: "mch_05", currency: "EUR" })).status).toBe(201)
  })

  it("rejects a body that is not JSON", async () => {
    expect((await post("not json")).status).toBe(400)
  })
})

describe("POST /api/cards/[id]/status", () => {
  it("enforces the state machine and answers 409 for a move it does not allow", async () => {
    const { card } = await (await post({ ...valid, nickname: "Status route" })).json()

    expect((await (await status(card.id, "freeze")).json()).card.status).toBe("frozen")
    expect((await status(card.id, "freeze")).status).toBe(409)
    expect((await (await status(card.id, "unfreeze")).json()).card.status).toBe("active")
    expect((await (await status(card.id, "cancel")).json()).card.status).toBe("cancelled")
    expect((await status(card.id, "unfreeze")).status).toBe(409)
    expect((await status(card.id, "bogus")).status).toBe(400)
    expect((await status("card_nope", "freeze")).status).toBe(404)
  })
})

describe("the library the routes rely on", () => {
  // The full suites are beside src/lib/cards.ts; these are the three facts
  // the handlers above depend on, stated where the handlers are tested.
  it("generates on the 4242 BIN with a Luhn check digit, and nothing leaves cancelled", () => {
    expect(luhnCheckDigit("424242424242424")).toBe(2)
    expect(generateCardNumber(() => 7)).toBe("4242777777777775")
    expect(CARD_TRANSITIONS).toEqual({
      active: { freeze: "frozen", cancel: "cancelled" },
      frozen: { unfreeze: "active", cancel: "cancelled" },
      cancelled: {},
    })
  })
})
