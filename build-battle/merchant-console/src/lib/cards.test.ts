import { describe, expect, it } from "vitest"
import {
  CARD_TRANSITIONS,
  availableCardActions,
  generateCardNumber,
  groupCardNumber,
  isLuhnValid,
  lastFour,
  luhnCheckDigit,
  maskCardNumber,
  nextCardStatus,
  spendPercent,
} from "./cards"

/**
 * Two things here must never drift: every generated number is on the 4242
 * test BIN with a valid check digit, and a cancelled card never comes back.
 */

describe("luhn", () => {
  it("computes the check digit and validates a whole number", () => {
    // 4242 4242 4242 4242 is the well-known test card; its last digit is 2.
    expect(luhnCheckDigit("424242424242424")).toBe(2)
    expect(luhnCheckDigit("7992739871")).toBe(3)
    expect(isLuhnValid("4242424242424242")).toBe(true)
    expect(isLuhnValid("4242424242424241")).toBe(false)
    expect(isLuhnValid("4242 4242")).toBe(false)
    expect(() => luhnCheckDigit("42x2")).toThrow()
  })
})

describe("generateCardNumber", () => {
  it("is sixteen digits on the 4242 BIN with a valid check digit, for any digit source", () => {
    expect(generateCardNumber(() => 7)).toBe("4242777777777775")
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const number = generateCardNumber(() => Math.floor(Math.random() * 10))
      expect(number).toMatch(/^4242\d{12}$/)
      expect(isLuhnValid(number)).toBe(true)
      seen.add(number)
    }
    expect(seen.size).toBeGreaterThan(490)
    expect(() => generateCardNumber(() => 10)).toThrow()
  })
})

describe("masking", () => {
  it("shows four dots and the last four, and groups the reveal in fours", () => {
    expect(lastFour("4242777777777775")).toBe("7775")
    expect(maskCardNumber("7775")).toBe("•••• 7775")
    expect(groupCardNumber("4242777777777775")).toBe("4242 7777 7777 7775")
  })
})

describe("status transitions", () => {
  it("allows active ⇄ frozen and either → cancelled, and nothing else", () => {
    expect(nextCardStatus("active", "freeze")).toBe("frozen")
    expect(nextCardStatus("frozen", "unfreeze")).toBe("active")
    expect(nextCardStatus("active", "cancel")).toBe("cancelled")
    expect(nextCardStatus("frozen", "cancel")).toBe("cancelled")
    expect(nextCardStatus("active", "unfreeze")).toBeNull()
    expect(nextCardStatus("frozen", "freeze")).toBeNull()
    expect(availableCardActions("active")).toEqual(["freeze", "cancel"])
    expect(availableCardActions("frozen")).toEqual(["unfreeze", "cancel"])
  })

  it("lets nothing out of cancelled", () => {
    for (const action of ["freeze", "unfreeze", "cancel"] as const) {
      expect(nextCardStatus("cancelled", action)).toBeNull()
    }
    expect(CARD_TRANSITIONS.cancelled).toEqual({})
    expect(availableCardActions("cancelled")).toEqual([])
  })
})

describe("spendPercent", () => {
  it("is integer arithmetic on minor units, floored, and never divides by zero", () => {
    expect(spendPercent(8000, 10000)).toBe(80)
    expect(spendPercent(7999, 10000)).toBe(79)
    expect(spendPercent(1, 3)).toBe(33)
    expect(spendPercent(12000, 10000)).toBe(120)
    expect(spendPercent(100, 0)).toBe(0)
  })
})
