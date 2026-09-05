---
name: Payment action replay after Checkout
description: Paid actions can finish while the customer is away on Stripe and must be replayed locally on return.
---

When a paid action is confirmed after the customer returns from hosted Checkout, the client must present it even if the server already marks it completed. Active-action snapshots are not a replay buffer, so completed actions need a local visual replay that survives the first state refresh, page reloads, and cleans itself up after the effect.

**Why:** The customer leaves the realtime connection during Checkout; the action can be created, executed, and removed from the active snapshot before the browser returns.

**How to apply:** Treat the payment status response as the recovery signal. Persist a short-lived client handoff with the target and pre-payment value, mask the authoritative snapshot while confirming, replay completed actions locally, keep the handoff until the visual timeline ends, and do not rely on a missed WebSocket event. Include exact previous/final values from the completed event so the client can mask the authoritative snapshot while animating.