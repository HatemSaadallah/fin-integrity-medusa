import { describe, it, expect } from "vitest";
import { FinIntegrityClient } from "@fin-integrity/node";
import type { EventEnvelope, Transport } from "@fin-integrity/node";
import {
  captureMedusaDispute,
  captureMedusaPayment,
  captureMedusaRefund,
  captureMedusaSubscription,
} from "../src/index.js";

class Capture implements Transport {
  sent: EventEnvelope[] = [];
  async send(batch: EventEnvelope[]): Promise<void> {
    this.sent.push(...batch);
  }
}

function client(): { fi: FinIntegrityClient; t: Capture } {
  const t = new Capture();
  return { fi: new FinIntegrityClient({ transport: t, batch: { maxSize: 1 } }), t };
}

describe("captureMedusaPayment", () => {
  it("sends a processor payment keyed by orderId with money in minor units", async () => {
    const { fi, t } = client();
    captureMedusaPayment(fi, {
      orderId: "order_01H",
      externalId: "pay_01H",
      amountMinor: 4999,
      currency: "USD",
      status: "captured",
    });
    await fi.flush();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      side: "processor",
      source: "medusa",
      event_type: "payment",
      reference: "order_01H", // the cross-side join key
      external_id: "pay_01H", // Medusa's native id
      amount: { minor: "4999", currency: "usd" },
      status: "captured",
    });
  });

  it("omits optional fields entirely when not supplied", async () => {
    const { fi, t } = client();
    captureMedusaPayment(fi, { orderId: "order_2", externalId: "pay_2", amountMinor: 100, currency: "eur" });
    await fi.flush();
    expect(t.sent[0]).not.toHaveProperty("status");
    expect(t.sent[0]).not.toHaveProperty("metadata");
    expect(t.sent[0]).not.toHaveProperty("subscription_id");
  });

  it("tags a renewal charge with its subscription id so the plan reconciles as paid", async () => {
    const { fi, t } = client();
    captureMedusaPayment(fi, {
      orderId: "order_renewal_3",
      externalId: "pay_renewal_3",
      amountMinor: 2500,
      currency: "usd",
      subscriptionId: "sub_gold",
    });
    await fi.flush();
    expect(t.sent[0]!.subscription_id).toBe("sub_gold");
    expect(t.sent[0]!.event_type).toBe("payment");
    // The charge still reconciles against its own order, not the subscription.
    expect(t.sent[0]!.reference).toBe("order_renewal_3");
  });
});

describe("captureMedusaRefund", () => {
  it("sends a refund event against the order", async () => {
    const { fi, t } = client();
    captureMedusaRefund(fi, {
      orderId: "order_4",
      externalId: "ref_4",
      amountMinor: 1500,
      currency: "usd",
      metadata: { reason: "damaged" },
    });
    await fi.flush();
    expect(t.sent[0]).toMatchObject({
      event_type: "refund",
      reference: "order_4",
      external_id: "ref_4",
      amount: { minor: "1500", currency: "usd" },
      metadata: { reason: "damaged" },
    });
  });
});

describe("captureMedusaDispute", () => {
  it("points at the disputed payment via parent_external_id while keeping the order as reference", async () => {
    const { fi, t } = client();
    captureMedusaDispute(fi, {
      orderId: "order_5",
      externalId: "dp_5",
      paymentExternalId: "pay_5",
      amountMinor: 4999,
      currency: "usd",
      status: "needs_response",
    });
    await fi.flush();
    expect(t.sent[0]).toMatchObject({
      event_type: "dispute",
      source: "medusa",
      reference: "order_5",
      external_id: "dp_5",
      parent_external_id: "pay_5", // the charge the dispute acts on
      amount: { minor: "4999", currency: "usd" },
      status: "needs_response",
    });
  });

  it("carries each dispute status through unchanged", async () => {
    const statuses = ["needs_response", "under_review", "won", "lost"] as const;
    const { fi, t } = client();
    for (const status of statuses) {
      captureMedusaDispute(fi, {
        orderId: "order_6",
        externalId: `dp_${status}`,
        paymentExternalId: "pay_6",
        amountMinor: 100,
        currency: "usd",
        status,
      });
    }
    await fi.flush();
    expect(t.sent.map((e) => e.status)).toEqual([...statuses]);
    // `lost` is the only settled money-out state, but every status is a dispute event.
    expect(t.sent.every((e) => e.event_type === "dispute")).toBe(true);
  });
});

describe("captureMedusaSubscription", () => {
  it("sends a subscription container keyed by its own id, not an order", async () => {
    const { fi, t } = client();
    captureMedusaSubscription(fi, {
      subscriptionId: "sub_gold",
      status: "active",
      amountMinor: 2500,
      currency: "USD",
      interval: "month",
      currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    });
    await fi.flush();
    expect(t.sent[0]).toMatchObject({
      side: "processor",
      source: "medusa",
      event_type: "subscription",
      reference: "sub_gold",
      external_id: "sub_gold",
      amount: { minor: "2500", currency: "usd" },
      status: "active",
      interval: "month",
      current_period_start: "2026-07-01T00:00:00.000Z",
      current_period_end: "2026-08-01T00:00:00.000Z",
    });
  });

  it("is not money movement — it never emits a payment/refund event type", async () => {
    const { fi, t } = client();
    captureMedusaSubscription(fi, {
      subscriptionId: "sub_trial",
      status: "trialing",
      amountMinor: 0,
      currency: "usd",
    });
    await fi.flush();
    expect(t.sent[0]!.event_type).toBe("subscription");
    expect(t.sent[0]).not.toHaveProperty("parent_external_id");
  });
});

describe("subscription + tagged charge", () => {
  it("emits a subscription and a charge that share a subscription id", async () => {
    const { fi, t } = client();
    captureMedusaSubscription(fi, { subscriptionId: "sub_9", status: "active", amountMinor: 999, currency: "usd" });
    captureMedusaPayment(fi, {
      orderId: "order_9",
      externalId: "pay_9",
      amountMinor: 999,
      currency: "usd",
      subscriptionId: "sub_9",
    });
    await fi.flush();
    const [sub, charge] = t.sent;
    expect(sub!.external_id).toBe(charge!.subscription_id);
    expect(sub!.amount.minor).toBe(charge!.amount.minor);
  });
});
