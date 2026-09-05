---
name: Payment action replay after Checkout
description: Paid actions can finish while the customer is away on Stripe and must be replayed locally on return.
---

When a paid action is confirmed after the customer returns from hosted Checkout, the client must present it even if the server already marks it completed. Active-action snapshots are not a replay buffer, so completed actions need a local visual replay that survives the first state refresh and cleans itself up after the effect.

**Why:** The customer leaves the realtime connection during Checkout; the action can be created, executed, and removed from the active snapshot before the browser returns.

**How to apply:** Treat the payment status response as the recovery signal. Wait for initial hydration, replay completed actions locally, keep the replay ID out of snapshot pruning until its visual timeline ends, and do not rely on a missed WebSocket event.