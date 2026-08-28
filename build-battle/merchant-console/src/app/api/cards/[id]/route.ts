import { cardById } from "@/data/cards"
import { NextRequest, NextResponse } from "next/server"

/** One card, masked. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const card = cardById(id)
  if (!card) {
    return NextResponse.json({ error: "No card with that id." }, { status: 404 })
  }
  return NextResponse.json({ card })
}
