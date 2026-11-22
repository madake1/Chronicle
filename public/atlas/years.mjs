import { constrainView } from '../chronology.mjs';

// Cliopatria uses signed historical years; its six zero endpoints bound the BCE records.
export function sourceYearToAxis(year) {
  return year < 0 ? year + 1 : year;
}

export function changeIndex(changes, year) {
  let low = 0;
  let high = changes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (changes[middle] <= year) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function zoomYears(window, pivot, factor, bounds) {
  const size = Math.max(20, Math.round((window[1] - window[0]) * factor));
  const start = pivot - Math.floor(size / 2);
  return constrainView([start, start + size], bounds);
}
