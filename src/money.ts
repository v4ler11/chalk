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
