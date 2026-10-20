export const formatDeparture = (value) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const formatPrice = (value) => `₹${Math.round(Number(value))}`;
