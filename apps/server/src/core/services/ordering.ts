import { generateKeyBetween } from 'fractional-indexing';

/**
 * Compute a fractional-index key for placing an item between two neighbours.
 *
 * @param after  position of the item it should sit below (null = not given)
 * @param before position of the item it should sit above (null = not given)
 * @param next   position of the first sibling strictly after `p` (excluding the moved item)
 * @param prev   position of the last sibling strictly before `p` (excluding the moved item)
 */
export function keyBetweenNeighbours(
  after: string | null,
  before: string | null,
  next: (p: string) => string | null,
  prev: (p: string) => string | null,
): string {
  let lo = after;
  let hi = before;
  if (lo !== null && hi === null) hi = next(lo);
  else if (lo === null && hi !== null) lo = prev(hi);
  // Inverted or tied neighbours (bad client input or equal keys): place right after `after`.
  if (lo !== null && hi !== null && lo >= hi) hi = next(lo);
  return generateKeyBetween(lo, hi);
}

export function keyAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}
