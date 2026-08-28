"use client"

import { Button } from "@/components/Button"
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/Drawer"
import { Input } from "@/components/Input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/Select"
import { Card, CardCategory, Currency } from "@/data/types"
import {
  CARD_CATEGORIES,
  CATEGORY_LABELS,
  MAX_NICKNAME_LENGTH,
  MAX_SPEND_LIMIT,
  groupCardNumber,
  maskCardNumber,
} from "@/lib/cards"
import { formatMoney, parseAmountToMinorUnits } from "@/lib/money"
import { Check, Copy, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useRef, useState } from "react"

interface MerchantOption {
  id: string
  name: string
  currency: Currency
  riskTier: "low" | "standard" | "elevated"
}

type FieldName = "nickname" | "merchantId" | "spendLimit" | "currency" | "category"
type FieldErrors = Partial<Record<FieldName, string>>
type Issued = { card: Card; number: string | null }

/** A request id per opening, sent as Idempotency-Key so a double click makes one card. */
const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `req_${Math.random().toString(36).slice(2)}`

/**
 * The issue form, then the one-time reveal. The number the server returns
 * lives in this component's state and nowhere else: closing the drawer
 * throws it away, and a response that lands after the drawer closed is
 * dropped rather than kept for the next opening.
 */
export function IssueCardDrawer({ merchants }: { merchants: MerchantOption[] }) {
  const router = useRouter()
  const ids = useId()
  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState("")
  const [nickname, setNickname] = useState("")
  const [merchantId, setMerchantId] = useState("")
  const [limitText, setLimitText] = useState("")
  const [category, setCategory] = useState<CardCategory>("any")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [copied, setCopied] = useState(false)
  // The request the drawer is waiting on; cleared on close so a late
  // response can be recognised and discarded.
  const inFlight = useRef<string | null>(null)

  const merchant = merchants.find((m) => m.id === merchantId)
  // A merchant settles in one currency and a card is issued in it.
  const currency: Currency = merchant?.currency ?? "USD"

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setRequestId(newRequestId())
      return
    }
    inFlight.current = null
    setNickname("")
    setMerchantId("")
    setLimitText("")
    setCategory("any")
    setErrors({})
    setFormError(null)
    setSubmitting(false)
    setIssued(null)
    setCopied(false)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    // Client-side checks are a convenience. The server runs its own.
    const spendLimit = parseAmountToMinorUnits(limitText)
    const local: FieldErrors = {}
    if (!nickname.trim()) local.nickname = "Give the card a nickname."
    if (!merchantId) local.merchantId = "Choose a merchant."
    if (spendLimit === null) local.spendLimit = "Enter an amount like 250.00."
    setErrors(local)
    if (Object.keys(local).length > 0) return

    const thisRequest = requestId
    inFlight.current = thisRequest
    setSubmitting(true)
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": thisRequest },
        body: JSON.stringify({ nickname: nickname.trim(), merchantId, spendLimit, currency, category }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        card?: Card
        number?: string
        error?: string
        fields?: FieldErrors
      }
      // Closed while in flight: the reveal is over, keep nothing, show the list.
      if (inFlight.current !== thisRequest) return router.refresh()
      if (response.status === 409) {
        setRequestId(newRequestId())
        setFormError(body.error ?? "This request id was already used. Check the list, then try again.")
      } else if (!response.ok || !body.card) {
        setErrors(body.fields ?? {})
        setFormError(body.error ?? "The console could not confirm whether the card was issued. Check the list before trying again.")
      } else {
        setIssued({ card: body.card, number: body.number ?? null })
        router.refresh()
      }
    } catch {
      if (inFlight.current === thisRequest) {
        setFormError("The console could not confirm the result. Check the list before trying again: if the card is there, its number was never shown, so cancel it and issue a new one.")
      }
    } finally {
      if (inFlight.current === thisRequest) inFlight.current = null
      setSubmitting(false)
    }
  }

  const copy = () =>
    issued?.number && navigator.clipboard.writeText(issued.number).then(() => setCopied(true), () => setCopied(false))

  const field = (name: FieldName, help?: string) => ({
    id: `${ids}-${name}`,
    hasError: Boolean(errors[name]),
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `${ids}-${name}-note` : help ? `${ids}-${name}-note` : undefined,
    className: "mt-2",
  })

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Button className="w-full gap-2 py-1.5 sm:w-fit">
          <Plus className="-ml-0.5 size-4 shrink-0" aria-hidden="true" />
          Issue card
        </Button>
      </DrawerTrigger>

      <DrawerContent>
        {issued ? (
          <>
            <DrawerHeader>
              <DrawerTitle>Card issued</DrawerTitle>
              <DrawerDescription>
                {issued.card.nickname} for {merchant?.name ?? issued.card.merchantId}.
                {issued.number
                  ? " Copy the number now. This is the only time the console will show it."
                  : " This request had already been issued. The console shows a number only at the moment of issue; if nobody saw it, cancel this card and issue a new one."}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-5">
              <div aria-live="polite" className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <p className="text-xs uppercase tracking-wide text-gray-500">Card number</p>
                <p className="mt-1 font-mono text-2xl tabular-nums tracking-wider text-gray-900 dark:text-gray-50">
                  {issued.number ? groupCardNumber(issued.number) : maskCardNumber(issued.card.last4)}
                </p>
                {issued.number && (
                  <Button variant="secondary" className="mt-3 gap-2 py-1.5" onClick={copy}>
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {copied ? "Copied" : "Copy number"}
                  </Button>
                )}
              </div>
              <p className="text-sm text-gray-500">
                {formatMoney(issued.card.spendLimit, issued.card.currency)} {issued.card.currency} ·{" "}
                {CATEGORY_LABELS[issued.card.category]} · shown everywhere else as{" "}
                <span className="font-mono">{maskCardNumber(issued.card.last4)}</span>
              </p>
            </DrawerBody>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="secondary" className="w-full sm:w-fit">Done</Button>
              </DrawerClose>
              <Button className="w-full sm:w-fit" asChild>
                <Link href={`/cards/${issued.card.id}`}>Open card</Link>
              </Button>
            </DrawerFooter>
          </>
        ) : (
          <>
            <DrawerHeader>
              <DrawerTitle>Issue a card</DrawerTitle>
              <DrawerDescription>A virtual card for one merchant, with a limit from the moment it exists.</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <form id={`${ids}-form`} noValidate onSubmit={submit} className="flex flex-col gap-5">
                <Labeled id={`${ids}-nickname`} label="Nickname" note={errors.nickname} error>
                  <Input
                    {...field("nickname")}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={MAX_NICKNAME_LENGTH}
                    placeholder="Google Ads"
                    autoComplete="off"
                  />
                </Labeled>

                <Labeled
                  id={`${ids}-merchantId`}
                  label="Merchant"
                  note={errors.merchantId ?? (merchant?.riskTier === "elevated" ? `${merchant.name} is an elevated-risk merchant. Double-check the limit before issuing.` : undefined)}
                  error={Boolean(errors.merchantId)}
                >
                  <Select value={merchantId} onValueChange={(id) => { setMerchantId(id); setErrors((e) => ({ ...e, merchantId: undefined, currency: undefined })) }}>
                    <SelectTrigger {...field("merchantId")}>
                      <SelectValue placeholder="Choose a merchant" />
                    </SelectTrigger>
                    <SelectContent>
                      {merchants.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name} · {m.currency}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Labeled
                    id={`${ids}-spendLimit`}
                    label="Spend limit"
                    note={errors.spendLimit ?? `Up to ${formatMoney(MAX_SPEND_LIMIT, currency)} ${currency}.`}
                    error={Boolean(errors.spendLimit)}
                  >
                    <Input
                      {...field("spendLimit", "help")}
                      value={limitText}
                      onChange={(e) => setLimitText(e.target.value)}
                      inputMode="decimal"
                      placeholder="250.00"
                      autoComplete="off"
                    />
                  </Labeled>
                  <Labeled
                    id={`${ids}-currency`}
                    label="Currency"
                    note={errors.currency ?? (merchant ? `Set by ${merchant.name}'s settlement currency.` : "Set by the merchant once one is chosen.")}
                    error={Boolean(errors.currency)}
                  >
                    <Input {...field("currency", "help")} value={currency} readOnly />
                  </Labeled>
                </div>

                <Labeled id={`${ids}-category`} label="Category lock" note={errors.category} error>
                  <Select value={category} onValueChange={(v) => setCategory(v as CardCategory)}>
                    <SelectTrigger {...field("category")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CARD_CATEGORIES.map((value) => (
                        <SelectItem key={value} value={value}>{CATEGORY_LABELS[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>

                {formError && (
                  <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                    {formError}
                  </p>
                )}
              </form>
            </DrawerBody>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="secondary" className="w-full sm:w-fit">Cancel</Button>
              </DrawerClose>
              <Button type="submit" form={`${ids}-form`} className="w-full sm:w-fit" disabled={submitting}>
                {submitting ? "Issuing…" : "Issue card"}
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

/** A label, a control, and one line under it: the error when there is one, else help. */
function Labeled({
  id,
  label,
  note,
  error,
  children,
}: {
  id: string
  label: string
  note?: string
  error?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-gray-900 dark:text-gray-50">
        {label}
      </label>
      {children}
      {note && (
        <p
          id={`${id}-note`}
          role={error && note ? "alert" : undefined}
          className={error ? "mt-1 text-xs text-red-600 dark:text-red-500" : "mt-1 text-xs text-gray-500"}
        >
          {note}
        </p>
      )}
    </div>
  )
}
