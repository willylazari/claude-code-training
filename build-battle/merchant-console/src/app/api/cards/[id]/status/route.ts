import { describeIllegalTransition, transitionCard } from "@/data/cards"
import { CARD_ACTIONS, CardAction } from "@/lib/cards"
import { NextRequest, NextResponse } from "next/server"

/**
 * Freeze, unfreeze, or cancel a card. The state machine is enforced here,
 * not in the UI: an action the machine does not allow is a 409, whatever
 * the client thought the card's status was.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Send the action as JSON." }, { status: 400 })
  }

  const action =
    body !== null && typeof body === "object"
      ? (body as { action?: unknown }).action
      : undefined
  if (typeof action !== "string" || !CARD_ACTIONS.includes(action as CardAction)) {
    return NextResponse.json(
      { error: "Action must be freeze, unfreeze, or cancel." },
      { status: 400 },
    )
  }

  const result = transitionCard(id, action as CardAction)
  if (result.error === "not_found") {
    return NextResponse.json({ error: "No card with that id." }, { status: 404 })
  }
  if (result.error === "illegal") {
    return NextResponse.json(
      { error: describeIllegalTransition(result.from, result.action) },
      { status: 409 },
    )
  }
  return NextResponse.json({ card: result.card })
}
