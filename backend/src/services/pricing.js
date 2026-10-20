import { percentOf } from "../lib/util.js";
import { getSetting } from "./settings.js";

// Cost-sharing guidance: a per-seat suggestion from distance, and a cap at a
// configurable multiple of it so contributions stay a share of running costs.
export const suggestedContribution = async (distanceM, client) => {
  const p = await getSetting("pricing", client);
  const raw = Math.round((distanceM / 1000) * p.suggested_paise_per_km);
  const suggested = Math.max(p.minimum_paise, Math.round(raw / 500) * 500); // nearest Rs 5
  // The cap rounds down to whole Rs 5 so limits read cleanly.
  const maxPaise = Math.floor((suggested * p.max_multiple_of_suggested) / 500) * 500;
  return { suggestedPaise: suggested, maxPaise, perKmPaise: p.suggested_paise_per_km };
};

export const platformFee = async (contributionPaise, client) => {
  const f = await getSetting("fees", client);
  if (!f.platform_fee_percent || contributionPaise === 0) return 0;
  return Math.max(f.platform_fee_min_paise, percentOf(contributionPaise, f.platform_fee_percent));
};

// Refund owed when a booking is cancelled, per the cancellation policy.
export const refundFor = async ({ paidPaise, departureAt, cancelledBy, now = new Date() }, client) => {
  const c = await getSetting("cancellation", client);
  if (paidPaise <= 0) return { refundPaise: 0, rule: "nothing paid" };
  if (cancelledBy === "driver" || cancelledBy === "system") {
    return { refundPaise: percentOf(paidPaise, c.driver_cancel_refund_percent), rule: `${c.driver_cancel_refund_percent}% when the driver or Green Way cancels` };
  }
  const minutesBefore = (new Date(departureAt).getTime() - now.getTime()) / 60000;
  if (minutesBefore >= c.free_until_minutes_before) return { refundPaise: paidPaise, rule: `full refund up to ${c.free_until_minutes_before / 60} hours before departure` };
  return { refundPaise: percentOf(paidPaise, c.late_refund_percent), rule: `${c.late_refund_percent}% refund for late cancellation` };
};
