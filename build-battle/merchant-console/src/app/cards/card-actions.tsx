"use client"

import { Button } from "@/components/Button"
import { CardStatus } from "@/data/types"
import { CardAction, availableCardActions } from "@/lib/cards"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

const LABELS: Record<CardAction, [idle: string, busy: string]> = {
  freeze: ["Freeze", "Freezing…"],
  unfreeze: ["Unfreeze", "Unfreezing…"],
  cancel: ["Cancel card", "Cancelling…"],
}

/**
 * Freeze, unfreeze, and (on the detail page) cancel. Posts to the status
 * route and refreshes the server component, so the list updates without a
 * full reload. Which buttons exist comes from the same transition table the
 * server enforces with; the server has the last word, and whatever it says,
 * the row is refreshed to match it.
 */
export function CardActions({
  id,
  status,
  nickname,
  withCancel = false,
}: {
  id: string
  status: CardStatus
  nickname: string
  withCancel?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<CardAction | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new status from the server settles any message about the old one.
  useEffect(() => {
    setError(null)
    setConfirming(false)
  }, [status])

  const actions = availableCardActions(status).filter((a) => withCancel || a !== "cancel")
  const busy = pending !== null || refreshing

  const run = async (action: CardAction) => {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/cards/${id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Could not ${action} the card. Try again.`)
      }
      // Refresh either way: on a refusal the server's status is the one to show.
      startRefresh(() => router.refresh())
    } catch {
      setError("The console could not reach the server. Try again.")
    } finally {
      setPending(null)
    }
  }

  if (actions.length === 0) {
    return <span className="text-sm text-gray-500">{status === "cancelled" ? "Cancelled is final" : "No actions"}</span>
  }

  const button = (action: CardAction, label: string, onClick: () => void, variant: "secondary" | "light" | "destructive" = "secondary") => (
    <Button key={label} variant={variant} className="px-2.5 py-1 text-xs" disabled={busy} onClick={onClick}>
      {pending === action ? LABELS[action][1] : label}
    </Button>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) =>
          action !== "cancel"
            ? button(action, LABELS[action][0], () => run(action))
            : confirming
              ? [
                  <span key="ask" className="text-sm text-gray-700 dark:text-gray-300">
                    Cancel {nickname}? This cannot be undone.
                  </span>,
                  button("cancel", "Yes, cancel it", () => run("cancel"), "destructive"),
                  button("cancel", "Keep card", () => setConfirming(false)),
                ]
              : button("cancel", LABELS.cancel[0], () => setConfirming(true), "light"),
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-500">{error}</p>}
    </div>
  )
}
