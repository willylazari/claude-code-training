import { issueCard, listCards, parseIssueCardInput } from "@/data/cards"
import { MAX_IDEMPOTENCY_KEY_LENGTH, isIdempotencyKey } from "@/lib/cards"
import { NextRequest, NextResponse } from "next/server"

/** Every issued card, masked. The full number is never in a list. */
export function GET() {
  return NextResponse.json({ cards: listCards() })
}

/**
 * Issue a card. The body and the Idempotency-Key are validated here, against
 * allowlists, before they reach the store. The 201 is the one and only place
 * the full number appears; a replayed key gets the card back without it, and
 * a reused key with a different body is refused.
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get("idempotency-key")
  if (key !== null && !isIdempotencyKey(key)) {
    return NextResponse.json(
      { error: `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} printable characters.` },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Send the card as a JSON object." },
      { status: 400 },
    )
  }

  const parsed = parseIssueCardInput(body)
  if (parsed.errors) {
    return NextResponse.json(
      { error: "Check the highlighted fields.", fields: parsed.errors },
      { status: 400 },
    )
  }

  const result = issueCard(parsed.input, { idempotencyKey: key ?? undefined })

  switch (result.kind) {
    case "issued":
      return NextResponse.json(
        { card: result.card, number: result.number },
        { status: 201 },
      )
    case "replayed":
      return NextResponse.json({ card: result.card, replayed: true })
    case "conflict":
      return NextResponse.json(
        {
          error:
            "That request id was already used to issue a different card. Reopen the form to get a new one.",
        },
        { status: 409 },
      )
  }
}
