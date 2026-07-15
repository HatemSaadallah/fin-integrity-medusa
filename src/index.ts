import type { FinIntegrityClient } from "@fin-integrity/node";

/**
 * Normalized fields pulled from a Medusa payment/refund inside a subscriber.
 * `orderId` is used as the reconciliation `reference` (both sides must agree on it).
 */
export interface MedusaMoneyEvent {
  orderId: string;
  externalId: string;
  amountMinor: number;
  currency: string;
  status?: string;
  occurredAt?: string | Date;
  metadata?: Record<string, unknown>;
  /**
   * The subscription this charge belongs to, when the order was created by a
   * recurring plan rather than a one-off checkout.
   *
   * Tag every renewal charge with this. Reconciliation matches subscriptions
   * against charges carrying a matching subscription id — an untagged renewal
   * charge makes the subscription look unpaid and fires a false incident.
   */
  subscriptionId?: string;
}

/**
 * Dispute statuses accepted by the ingest API. Only `lost` is settled money-out;
 * the rest are the dispute's lifecycle before the money is decided.
 */
export type MedusaDisputeStatus = "needs_response" | "under_review" | "won" | "lost";

/**
 * A dispute (chargeback) raised against an order's payment. Medusa has no native
 * dispute object — it comes from the payment processor — but a merchant
 * reconciling Medusa against that processor still has to record it, keyed to the
 * order it acts on.
 */
export interface MedusaDisputeEvent extends Omit<MedusaMoneyEvent, "status" | "subscriptionId"> {
  /** The disputed Medusa payment's `externalId` — the charge this dispute acts on. */
  paymentExternalId: string;
  status: MedusaDisputeStatus;
}

/** Lifecycle states of a Medusa recurring plan. */
export type MedusaSubscriptionStatus = "active" | "past_due" | "canceled" | "paused" | "trialing";

/**
 * A Medusa recurring plan. Not money movement — it's the container a charge is
 * expected to arrive in, which is what lets reconciliation catch a billing
 * period that produced no charge at all. It spans many orders, so it has no
 * `orderId`: the subscription id is its own reconciliation key.
 *
 * Emit it whenever the plan changes (created, renewed, status change) so
 * `currentPeriodEnd` stays current.
 */
export interface MedusaSubscriptionEvent {
  subscriptionId: string;
  status: MedusaSubscriptionStatus;
  /** Amount billed each period. */
  amountMinor: number;
  currency: string;
  interval?: "day" | "week" | "month" | "year";
  currentPeriodStart?: string | Date;
  /** When the next charge is expected by. */
  currentPeriodEnd?: string | Date;
  occurredAt?: string | Date;
  metadata?: Record<string, unknown>;
}

/** Capture a Medusa payment/capture as a fin-integrity processor payment event. */
export function captureMedusaPayment(fi: FinIntegrityClient, e: MedusaMoneyEvent): void {
  fi.processor.record({
    type: "payment",
    source: "medusa",
    reference: e.orderId,
    external_id: e.externalId,
    amount: { minor: e.amountMinor, currency: e.currency },
    ...(e.subscriptionId ? { subscriptionId: e.subscriptionId } : {}),
    ...(e.status ? { status: e.status } : {}),
    ...(e.occurredAt ? { occurred_at: e.occurredAt } : {}),
    ...(e.metadata ? { metadata: e.metadata } : {}),
  });
}

/** Capture a Medusa refund as a fin-integrity processor refund event. */
export function captureMedusaRefund(fi: FinIntegrityClient, e: MedusaMoneyEvent): void {
  fi.processor.record({
    type: "refund",
    source: "medusa",
    reference: e.orderId,
    external_id: e.externalId,
    amount: { minor: e.amountMinor, currency: e.currency },
    ...(e.status ? { status: e.status } : {}),
    ...(e.occurredAt ? { occurred_at: e.occurredAt } : {}),
    ...(e.metadata ? { metadata: e.metadata } : {}),
  });
}

/**
 * Capture a dispute raised against an order's payment.
 *
 * Reconciles through the same path as a refund — money leaving against a charge —
 * so it keeps the order as its `reference` and points at the disputed payment via
 * `parentExternalId`. Only `status: "lost"` is settled money-out; the other
 * statuses record the dispute's progress without moving money.
 */
export function captureMedusaDispute(fi: FinIntegrityClient, e: MedusaDisputeEvent): void {
  fi.processor.record({
    type: "dispute",
    source: "medusa",
    reference: e.orderId,
    external_id: e.externalId,
    parentExternalId: e.paymentExternalId,
    amount: { minor: e.amountMinor, currency: e.currency },
    status: e.status,
    ...(e.occurredAt ? { occurred_at: e.occurredAt } : {}),
    ...(e.metadata ? { metadata: e.metadata } : {}),
  });
}

/**
 * Capture a Medusa recurring plan so reconciliation knows a charge is due each
 * period. Pair it with `captureMedusaPayment({ subscriptionId })` on the renewal
 * order's payment, otherwise the plan looks unpaid every period.
 */
export function captureMedusaSubscription(fi: FinIntegrityClient, e: MedusaSubscriptionEvent): void {
  fi.processor.recordSubscription({
    source: "medusa",
    external_id: e.subscriptionId,
    status: e.status,
    amount: { minor: e.amountMinor, currency: e.currency },
    ...(e.interval ? { interval: e.interval } : {}),
    ...(e.currentPeriodStart ? { currentPeriodStart: e.currentPeriodStart } : {}),
    ...(e.currentPeriodEnd ? { currentPeriodEnd: e.currentPeriodEnd } : {}),
    ...(e.occurredAt ? { occurred_at: e.occurredAt } : {}),
    ...(e.metadata ? { metadata: e.metadata } : {}),
  });
}
