/**
 * How a bar chart's category labels fit under the bars.
 *
 * Recharts drops labels that would overlap, which in a narrow panel leaves
 * bars without names. With every label shown, a label wider than its bar's
 * slot is tilted instead; the axis grows to make room for it.
 *
 * Widths are estimated for the 11px chart font rather than measured, so
 * this works the same on the server, in tests and in the browser.
 */

const FONT_SIZE = 11;
export const TILT_DEGREES = 40;
const MAX_AXIS_HEIGHT = 92;
/** Recharts' YAxis is 60 wide; CategoryBarChart pulls it 18px left and keeps 8px on the right. */
const PLOT_INSET = 60 - 18 + 8;

/** Approximate rendered width of a label at 11px. */
export function labelWidth(text) {
  let width = 0;
  for (const char of String(text ?? '')) {
    if (/[A-Z]/.test(char)) width += FONT_SIZE * 0.66;
    else if (/[a-z0-9]/.test(char)) width += FONT_SIZE * 0.54;
    else width += FONT_SIZE * 0.36;
  }
  return Math.ceil(width);
}

/**
 * @param {string[]} labels       one per bar, in order
 * @param {number}   chartWidth   the chart's width in px (0 while unknown)
 * @returns {{ tilted: boolean, axisHeight: number, maxLabel: number }}
 */
export function categoryAxisLayout(labels, chartWidth) {
  const widest = Math.max(0, ...labels.map(labelWidth));
  const count = labels.length;
  if (!count || !chartWidth) return { tilted: false, axisHeight: 30, maxLabel: widest };
  const slot = Math.max(0, chartWidth - PLOT_INSET) / count;
  if (widest <= slot - 6) return { tilted: false, axisHeight: 30, maxLabel: widest };
  const radians = (TILT_DEGREES * Math.PI) / 180;
  const axisHeight = Math.min(MAX_AXIS_HEIGHT, Math.ceil(widest * Math.sin(radians) + FONT_SIZE + 10));
  // The longest label that still fits the axis once tilted.
  const maxLabel = Math.floor((MAX_AXIS_HEIGHT - FONT_SIZE - 10) / Math.sin(radians));
  return { tilted: true, axisHeight, maxLabel };
}

/** Shortens a label to the given width, with an ellipsis. */
export function fitLabel(text, maxWidth) {
  const label = String(text ?? '');
  if (labelWidth(label) <= maxWidth) return label;
  let cut = label;
  while (cut.length > 1 && labelWidth(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
