/**
 * A price, written as money: two decimals, `$0.00`.
 *
 * An answer on a cheap model costs a fraction of a cent, so most prices read
 * `$0.00` at this resolution — which is the format the app asks for, and the
 * resolution a total is read at.
 */
export function price(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * What a chat has cost, as the composer's bar reads it: the whole of it and,
 * after a `+`, what the newest message added to the whole.
 *
 * An amount that comes to nothing is left out rather than written: a chat that
 * has cost nothing says nothing at all, and an answer that cost nothing — a
 * cached response, a model that prices none — does not put a `+$0.00` beside a
 * total. At the resolution prices are written in, anything under half a cent
 * *is* `$0.00`, so it is that same nothing and is left out with it.
 */
export function spend(total: number, latest: number): string {
  if (total < 0.005) return "";
  return latest < 0.005 ? price(total) : `${price(total)} +${price(latest)}`;
}
