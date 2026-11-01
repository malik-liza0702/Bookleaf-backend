/** Postgres DATE columns come back as midnight-UTC Date objects; expose them as YYYY-MM-DD. */
export function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Parses YYYY-MM-DD from the dataset into a midnight-UTC Date for a DATE column. */
export function fromDateOnly(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}
