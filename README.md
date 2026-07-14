# @fin-integrity/medusa

Medusa adapter for [**fin-integrity**](https://github.com/HatemSaadallah/fin-integrity-node) — _reconciliation-as-you-code_. Capture order payments and refunds from your Medusa store as processor events, on top of the core [`@fin-integrity/node`](https://github.com/HatemSaadallah/fin-integrity-node) client.

## Install

```bash
npm install @fin-integrity/node @fin-integrity/medusa
```

## Usage (Medusa v2 subscribers)

Wire the helpers into Medusa subscribers. Use the order id as the `reference` so it lines up with your ledger side.

```ts
// src/subscribers/fin-integrity.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { init } from "@fin-integrity/node";
import { captureMedusaPayment } from "@fin-integrity/medusa";

const fi = init({ apiKey: process.env.FIN_INTEGRITY_KEY });

export default async function paymentCaptured({ event, container }: SubscriberArgs<{ id: string }>) {
  const paymentModule = container.resolve("payment");
  const payment = await paymentModule.retrievePayment(event.data.id, { relations: ["payment_collection"] });

  captureMedusaPayment(fi, {
    orderId: String(payment.metadata?.order_id ?? payment.id), // the shared reconciliation key
    externalId: payment.id,
    amountMinor: Number(payment.amount),
    currency: payment.currency_code,
    status: "captured",
  });
  await fi.flush();
}

export const config: SubscriberConfig = { event: "payment.captured" };
```

Do the same for refunds with `captureMedusaRefund` on the `refund.created` event. For the ledger side, call the core client's `fi.ledger.record(...)` wherever your store writes its books.

## API

- **`captureMedusaPayment(fi, event)`** — record a captured payment.
- **`captureMedusaRefund(fi, event)`** — record a refund.

Both take `{ orderId, externalId, amountMinor, currency, status?, occurredAt?, metadata? }`. `amountMinor` is integer minor units (Medusa amounts are already integers).

## License

[MIT](./LICENSE) © fin-integrity
