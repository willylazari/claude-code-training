import { Divider } from "@/components/Divider"
import { Field } from "@/components/ui/detail/Field"
import { Timeline } from "@/components/ui/detail/Timeline"
import { StatusBadge } from "@/components/ui/payments/StatusBadge"
import { cardById } from "@/data/cards"
import { merchantById } from "@/data/merchants"
import { CardEventType } from "@/data/types"
import { CATEGORY_LABELS, maskCardNumber } from "@/lib/cards"
import { formatInZone } from "@/lib/dates"
import { formatMoney } from "@/lib/money"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CardActions } from "../card-actions"
import { SpendBar } from "../spend-bar"

const EVENT_LABELS: Record<CardEventType, string> = {
  issued: "Card issued",
  frozen: "Frozen",
  unfrozen: "Unfrozen",
  cancelled: "Cancelled",
}

export default async function CardDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = cardById(id)
  if (!card) notFound()

  const merchant = merchantById(card.merchantId)!
  const available = Math.max(card.spendLimit - card.spent, 0)

  return (
    <div className="p-4 sm:p-6">
      <Link
        href="/cards"
        className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-50"
      >
        ← All cards
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
          {card.nickname}
        </h1>
        <StatusBadge status={card.status} />
      </div>
      <p className="mt-1 font-mono text-sm text-gray-500">
        {maskCardNumber(card.last4)} · {card.id}
      </p>

      <Divider />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
            Spend against limit
          </h2>
          <div className="mt-4">
            <SpendBar spent={card.spent} limit={card.spendLimit} currency={card.currency} />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            {formatMoney(available, card.currency)} left on this card. Changing the limit
            after issue is NWP-202; today the route is cancel and reissue.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
            Actions
          </h2>
          <div className="mt-4">
            <CardActions
              id={card.id}
              status={card.status}
              nickname={card.nickname}
              withCancel
            />
          </div>
        </div>
      </div>

      <Divider />

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Merchant">
          {merchant.name}
          <span className="ml-2 text-gray-500">{merchant.country}</span>
          {merchant.riskTier === "elevated" && (
            <span className="ml-2 text-orange-600 dark:text-orange-500">Elevated risk</span>
          )}
        </Field>
        <Field label="Category lock">{CATEGORY_LABELS[card.category]}</Field>
        <Field label="Currency">{card.currency}</Field>
        <Field label="Spend limit">
          <span className="tabular-nums">{formatMoney(card.spendLimit, card.currency)}</span>
        </Field>
        <Field label="Spent">
          <span className="tabular-nums">{formatMoney(card.spent, card.currency)}</span>
        </Field>
        <Field label="Available">
          <span className="tabular-nums">{formatMoney(available, card.currency)}</span>
        </Field>
        <Field label="Created (UTC)">
          <span className="font-mono text-sm">{card.createdAt}</span>
        </Field>
        <Field label={`Created (${merchant.timezone})`}>
          {formatInZone(card.createdAt, merchant.timezone)}
        </Field>
        <Field label="Number reference">
          <span className="font-mono text-sm">{card.numberRef}</span>
        </Field>
      </dl>

      <Divider />

      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">
        History
      </h2>
      <Timeline
        entries={card.history.map((event) => ({ label: EVENT_LABELS[event.type], at: event.at }))}
        timeZone={merchant.timezone}
      />
    </div>
  )
}
