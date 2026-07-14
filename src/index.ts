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
}

/** Capture a Medusa payment/capture as a fin-integrity processor payment event. */
export function captureMedusaPayment(fi: FinIntegrityClient, e: MedusaMoneyEvent): void {
  fi.processor.record({
    type: "payment",
    source: "medusa",
    reference: e.orderId,
    external_id: e.externalId,
    amount: { minor: e.amountMinor, currency: e.currency },
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
