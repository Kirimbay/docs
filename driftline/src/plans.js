/** Plan limits enforced by the server, not just the pricing page. */
export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    price: 0,
    watches: 3,
    minInterval: 1440,
    webhook: false,
    summary: "3 pages, checked once a day",
  },
  studio: {
    id: "studio",
    label: "Studio",
    price: 15,
    watches: 30,
    minInterval: 360,
    webhook: false,
    summary: "30 pages, every 6 hours",
  },
  desk: {
    id: "desk",
    label: "Desk",
    price: 39,
    watches: 150,
    minInterval: 60,
    webhook: true,
    summary: "150 pages, every hour, plus a webhook",
  },
};

export const INTERVALS = [
  { minutes: 1440, label: "Once a day" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 60, label: "Every hour" },
];

export function planById(id) {
  return PLANS[id] || PLANS.free;
}

export function intervalsFor(planId) {
  const min = planById(planId).minInterval;
  return INTERVALS.filter((item) => item.minutes >= min);
}

export function allowsInterval(planId, minutes) {
  return intervalsFor(planId).some((item) => item.minutes === minutes);
}

export function intervalLabel(minutes) {
  return INTERVALS.find((item) => item.minutes === minutes)?.label || `${minutes} min`;
}
