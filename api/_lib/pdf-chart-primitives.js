/**
 * pdf-chart-primitives.js
 * Vector chart drawing on top of pdf-lib: bar, grouped bar, line, donut,
 * horizontal progress bars and data tables.
 *
 * Everything is drawn with pdf-lib's native primitives, so the PDF stays
 * small, prints crisply at any zoom, and the serverless bundle avoids a
 * headless-browser dependency (which would not fit Vercel's limits).
 *
 * All colours come from the Academic Nexus palette so a printed report
 * looks like the portal it came from.
 */

// pdf-lib ships as CommonJS; import the default export and destructure so
// this works under Node's native ESM loader on Vercel.
import pdfLib from 'pdf-lib';

const { rgb } = pdfLib;

/** Academic Nexus palette (hex -> pdf-lib rgb) */
export const PALETTE = {
  primary: rgb(0.761, 0.255, 0.047),      // #c2410c
  primaryLight: rgb(0.918, 0.345, 0.047), // #ea580c
  primarySoft: rgb(0.992, 0.925, 0.890),  // #fdece3
  secondary: rgb(0.976, 0.451, 0.086),    // #f97316
  slate: rgb(0.659, 0.635, 0.616),        // #a8a29e
  slateLight: rgb(0.906, 0.867, 0.839),   // #e7ddd6
  ink: rgb(0.110, 0.098, 0.090),          // #1c1917
  muted: rgb(0.341, 0.325, 0.306),        // #57534e
  outline: rgb(0.949, 0.894, 0.863),      // #f2e4dc
  surface: rgb(0.992, 0.980, 0.973),      // #fdfaf8
  surfaceAlt: rgb(0.980, 0.945, 0.925),   // #faf1ec
  white: rgb(1, 1, 1),
  success: rgb(0.086, 0.639, 0.290),      // #16a34a
  warning: rgb(0.851, 0.467, 0.024),      // #d97706
  error: rgb(0.863, 0.149, 0.149)         // #dc2626
};

/** Series colours, in the order charts consume them. */
export const SERIES_COLORS = [
  PALETTE.primary,
  PALETTE.secondary,
  PALETTE.slate,
  PALETTE.primaryLight,
  PALETTE.slateLight,
  PALETTE.warning
];

export function truncate(text, font, size, maxWidth) {
  let value = String(text ?? '');
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

export function drawSectionHeading(page, fonts, { x, y, text, width }) {
  page.drawText(text, { x, y, size: 12, font: fonts.bold, color: PALETTE.ink });
  page.drawLine({
    start: { x, y: y - 5 },
    end: { x: x + width, y: y - 5 },
    thickness: 0.75,
    color: PALETTE.outline
  });
  return y - 20;
}

/** A row of KPI cards. Returns the y coordinate below the row. */
export function drawStatCards(page, fonts, { x, y, width, cards, perRow = 4 }) {
  const gap = 10;
  const cardWidth = (width - gap * (perRow - 1)) / perRow;
  const cardHeight = 52;
  let currentY = y;

  cards.forEach((card, index) => {
    const column = index % perRow;
    if (column === 0 && index > 0) currentY -= cardHeight + gap;
    const cardX = x + column * (cardWidth + gap);
    const cardY = currentY - cardHeight;

    page.drawRectangle({
      x: cardX, y: cardY, width: cardWidth, height: cardHeight,
      color: PALETTE.surface, borderColor: PALETTE.outline, borderWidth: 0.75
    });
    // accent stripe
    page.drawRectangle({
      x: cardX, y: cardY, width: 3, height: cardHeight,
      color: card.accent ?? PALETTE.primary
    });
    page.drawText(truncate(card.label.toUpperCase(), fonts.regular, 7, cardWidth - 16), {
      x: cardX + 10, y: cardY + cardHeight - 16, size: 7, font: fonts.regular, color: PALETTE.muted
    });
    page.drawText(String(card.value), {
      x: cardX + 10, y: cardY + cardHeight - 36, size: 17, font: fonts.bold, color: PALETTE.ink
    });
    if (card.caption) {
      page.drawText(truncate(card.caption, fonts.regular, 7, cardWidth - 16), {
        x: cardX + 10, y: cardY + 8, size: 7, font: fonts.regular, color: PALETTE.slate
      });
    }
  });

  const rows = Math.ceil(cards.length / perRow);
  return y - rows * cardHeight - (rows - 1) * gap - 14;
}

function niceAxisMax(rawMax) {
  if (rawMax <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const scaled = rawMax / magnitude;
  const rounded = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return rounded * magnitude;
}

/**
 * Vertical bar chart with a value axis, gridlines and value labels.
 * data: [{ label, value }]
 */
export function drawBarChart(page, fonts, { x, y, width, height, data, title, color = PALETTE.primary }) {
  const plotBottom = y - height;
  const axisWidth = 26;
  const plotX = x + axisWidth;
  const plotWidth = width - axisWidth;
  const labelBand = 16;
  // Room above the top gridline for the tallest bar's value, so it does
  // not run into the title.
  const valueBand = 10;
  const plotHeight = height - labelBand - valueBand;

  if (title) {
    page.drawText(title, { x, y: y + 6, size: 9, font: fonts.bold, color: PALETTE.ink });
  }

  // Counts: four whole-number steps (0-4, 0-8, 0-20 ...), never 0, 1, 1, 2, 2.
  const rawMax = Math.max(...data.map((d) => Number(d.value) || 0), 0);
  const maxValue = (rawMax <= 4 ? 1 : niceAxisMax(rawMax / 4)) * 4;

  // gridlines + axis labels
  for (let step = 0; step <= 4; step += 1) {
    const value = (maxValue / 4) * step;
    const lineY = plotBottom + labelBand + (plotHeight * step) / 4;
    // Dashed like the portal's charts; the baseline is solid.
    page.drawLine({
      start: { x: plotX, y: lineY }, end: { x: x + width, y: lineY },
      thickness: step === 0 ? 0.4 : 0.6, color: step === 0 ? PALETTE.slateLight : PALETTE.outline,
      ...(step === 0 ? {} : { dashArray: [2.5, 2.5] })
    });
    page.drawText(String(Math.round(value)), {
      x: x + axisWidth - 6 - fonts.regular.widthOfTextAtSize(String(Math.round(value)), 6.5),
      y: lineY - 2, size: 6.5, font: fonts.regular, color: PALETTE.slate
    });
  }

  if (!data.length) {
    page.drawText('No data for this period', {
      x: plotX + 8, y: plotBottom + labelBand + plotHeight / 2, size: 8,
      font: fonts.regular, color: PALETTE.slate
    });
    return plotBottom - 10;
  }

  const slot = plotWidth / data.length;
  const barWidth = Math.min(slot * 0.55, 44);

  data.forEach((point, index) => {
    const value = Number(point.value) || 0;
    const barHeight = maxValue === 0 ? 0 : (value / maxValue) * plotHeight;
    const barX = plotX + slot * index + (slot - barWidth) / 2;
    const barY = plotBottom + labelBand;

    // Rounded top corners, like the portal's bars.
    const drawnHeight = Math.max(barHeight, value > 0 ? 1.5 : 0);
    if (drawnHeight > 0) {
      const r = Math.min(3, barWidth / 2, drawnHeight);
      page.drawSvgPath(
        `M0,${drawnHeight} L0,${r} Q0,0 ${r},0 L${barWidth - r},0 Q${barWidth},0 ${barWidth},${r} L${barWidth},${drawnHeight} Z`,
        { x: barX, y: barY + drawnHeight, color: point.color ?? color, borderWidth: 0 }
      );
    }
    if (value > 0) {
      const valueText = String(value);
      page.drawText(valueText, {
        x: barX + barWidth / 2 - fonts.bold.widthOfTextAtSize(valueText, 7) / 2,
        y: barY + barHeight + 3, size: 7, font: fonts.bold, color: PALETTE.ink
      });
    }
    const label = truncate(point.label, fonts.regular, 6.5, slot - 2);
    page.drawText(label, {
      x: plotX + slot * index + slot / 2 - fonts.regular.widthOfTextAtSize(label, 6.5) / 2,
      y: plotBottom + 4, size: 6.5, font: fonts.regular, color: PALETTE.muted
    });
  });

  return plotBottom - 10;
}

/**
 * Grouped bars — used for "created vs resolved" comparisons.
 * data: [{ label, values: [n, n] }], series: [{ name, color }]
 */
export function drawGroupedBarChart(page, fonts, { x, y, width, height, data, series, title }) {
  const plotBottom = y - height;
  const axisWidth = 26;
  const plotX = x + axisWidth;
  const plotWidth = width - axisWidth;
  const labelBand = 16;
  const plotHeight = height - labelBand;

  if (title) page.drawText(title, { x, y: y + 6, size: 9, font: fonts.bold, color: PALETTE.ink });

  const flat = data.flatMap((d) => d.values.map(Number));
  const maxValue = niceAxisMax(Math.max(...flat, 0));

  for (let step = 0; step <= 4; step += 1) {
    const lineY = plotBottom + labelBand + (plotHeight * step) / 4;
    page.drawLine({
      start: { x: plotX, y: lineY }, end: { x: x + width, y: lineY },
      thickness: 0.4, color: step === 0 ? PALETTE.slateLight : PALETTE.surfaceAlt
    });
    const labelText = String(Math.round((maxValue / 4) * step));
    page.drawText(labelText, {
      x: x + axisWidth - 6 - fonts.regular.widthOfTextAtSize(labelText, 6.5),
      y: lineY - 2, size: 6.5, font: fonts.regular, color: PALETTE.slate
    });
  }

  if (!data.length) {
    page.drawText('No data for this period', {
      x: plotX + 8, y: plotBottom + labelBand + plotHeight / 2,
      size: 8, font: fonts.regular, color: PALETTE.slate
    });
    return plotBottom - 10;
  }

  const slot = plotWidth / data.length;
  const groupWidth = Math.min(slot * 0.62, 40);
  const barWidth = groupWidth / series.length;

  data.forEach((group, groupIndex) => {
    const groupX = plotX + slot * groupIndex + (slot - groupWidth) / 2;
    group.values.forEach((rawValue, seriesIndex) => {
      const value = Number(rawValue) || 0;
      const barHeight = maxValue === 0 ? 0 : (value / maxValue) * plotHeight;
      page.drawRectangle({
        x: groupX + barWidth * seriesIndex,
        y: plotBottom + labelBand,
        width: barWidth - 1,
        height: Math.max(barHeight, value > 0 ? 1.5 : 0),
        color: series[seriesIndex].color
      });
    });
    const label = truncate(group.label, fonts.regular, 6.5, slot - 2);
    page.drawText(label, {
      x: plotX + slot * groupIndex + slot / 2 - fonts.regular.widthOfTextAtSize(label, 6.5) / 2,
      y: plotBottom + 4, size: 6.5, font: fonts.regular, color: PALETTE.muted
    });
  });

  drawLegend(page, fonts, { x: plotX, y: y + 6, items: series.map((s) => ({ label: s.name, color: s.color })), align: 'right', rightEdge: x + width });
  return plotBottom - 10;
}

/** Line chart with markers — used for GPA and volume trends. */
export function drawLineChart(page, fonts, { x, y, width, height, data, title, color = PALETTE.primary, valueMax }) {
  const plotBottom = y - height;
  const axisWidth = 26;
  const plotX = x + axisWidth;
  const plotWidth = width - axisWidth;
  const labelBand = 16;
  const plotHeight = height - labelBand;

  if (title) page.drawText(title, { x, y: y + 6, size: 9, font: fonts.bold, color: PALETTE.ink });

  const maxValue = valueMax ?? niceAxisMax(Math.max(...data.map((d) => Number(d.value) || 0), 0));

  for (let step = 0; step <= 4; step += 1) {
    const lineY = plotBottom + labelBand + (plotHeight * step) / 4;
    page.drawLine({
      start: { x: plotX, y: lineY }, end: { x: x + width, y: lineY },
      thickness: 0.4, color: step === 0 ? PALETTE.slateLight : PALETTE.surfaceAlt
    });
    const labelText = (maxValue / 4 * step).toFixed(maxValue <= 10 ? 1 : 0);
    page.drawText(labelText, {
      x: x + axisWidth - 6 - fonts.regular.widthOfTextAtSize(labelText, 6.5),
      y: lineY - 2, size: 6.5, font: fonts.regular, color: PALETTE.slate
    });
  }

  if (data.length < 1) {
    page.drawText('Not enough data to plot a trend', {
      x: plotX + 8, y: plotBottom + labelBand + plotHeight / 2,
      size: 8, font: fonts.regular, color: PALETTE.slate
    });
    return plotBottom - 10;
  }

  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const pointAt = (index) => ({
    x: data.length > 1 ? plotX + step * index : plotX + plotWidth / 2,
    y: plotBottom + labelBand + (maxValue === 0 ? 0 : ((Number(data[index].value) || 0) / maxValue) * plotHeight)
  });

  for (let i = 0; i < data.length - 1; i += 1) {
    page.drawLine({ start: pointAt(i), end: pointAt(i + 1), thickness: 1.6, color });
  }
  data.forEach((point, index) => {
    const p = pointAt(index);
    page.drawCircle({ x: p.x, y: p.y, size: 2.6, color });
    const valueText = String(point.value);
    page.drawText(valueText, {
      x: p.x - fonts.bold.widthOfTextAtSize(valueText, 6.5) / 2,
      y: p.y + 6, size: 6.5, font: fonts.bold, color: PALETTE.ink
    });
    const label = truncate(point.label, fonts.regular, 6.5, Math.max(step, 34));
    page.drawText(label, {
      x: p.x - fonts.regular.widthOfTextAtSize(label, 6.5) / 2,
      y: plotBottom + 4, size: 6.5, font: fonts.regular, color: PALETTE.muted
    });
  });

  return plotBottom - 10;
}

/**
 * Donut chart built from SVG arc paths.
 * slices: [{ label, value, color }]
 */
export function drawDonutChart(page, fonts, { centerX, centerY, radius, thickness = 22, slices, title, titleY }) {
  const total = slices.reduce((sum, s) => sum + (Number(s.value) || 0), 0);

  if (title) {
    page.drawText(title, {
      x: centerX - radius - 4, y: titleY ?? centerY + radius + 14,
      size: 9, font: fonts.bold, color: PALETTE.ink
    });
  }

  if (total === 0) {
    page.drawCircle({ x: centerX, y: centerY, size: radius, borderColor: PALETTE.surfaceAlt, borderWidth: thickness });
    const msg = 'No data';
    page.drawText(msg, {
      x: centerX - fonts.regular.widthOfTextAtSize(msg, 8) / 2,
      y: centerY - 3, size: 8, font: fonts.regular, color: PALETTE.slate
    });
    return;
  }

  const inner = radius - thickness;
  let startAngle = -Math.PI / 2; // 12 o'clock

  slices.forEach((slice) => {
    const value = Number(slice.value) || 0;
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    const endAngle = startAngle + sweep;
    const largeArc = sweep > Math.PI ? 1 : 0;

    // pdf-lib's drawSvgPath uses a y-down coordinate space anchored at (x, y).
    const outerStart = { x: Math.cos(startAngle) * radius, y: Math.sin(startAngle) * radius };
    const outerEnd = { x: Math.cos(endAngle) * radius, y: Math.sin(endAngle) * radius };
    const innerEnd = { x: Math.cos(endAngle) * inner, y: Math.sin(endAngle) * inner };
    const innerStart = { x: Math.cos(startAngle) * inner, y: Math.sin(startAngle) * inner };

    const path =
      `M ${outerStart.x} ${outerStart.y} ` +
      `A ${radius} ${radius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} ` +
      `L ${innerEnd.x} ${innerEnd.y} ` +
      `A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;

    page.drawSvgPath(path, { x: centerX, y: centerY, color: slice.color, borderWidth: 0 });
    startAngle = endAngle;
  });

  const totalText = String(total);
  page.drawText(totalText, {
    x: centerX - fonts.bold.widthOfTextAtSize(totalText, 15) / 2,
    y: centerY - 2, size: 15, font: fonts.bold, color: PALETTE.ink
  });
  page.drawText('total', {
    x: centerX - fonts.regular.widthOfTextAtSize('total', 6.5) / 2,
    y: centerY - 13, size: 6.5, font: fonts.regular, color: PALETTE.slate
  });
}

/**
 * Legend chips. Wraps onto extra rows when the items do not fit in
 * `maxWidth`, so a long label can never run off the edge of the page.
 * Returns the y coordinate below the last row.
 */
export function drawLegend(page, fonts, { x, y, items, gap = 12, align = 'left', rightEdge, maxWidth }) {
  const size = 7;
  const available = maxWidth ?? (rightEdge != null ? rightEdge - x : 520);
  const chipWidth = (item) => 10 + fonts.regular.widthOfTextAtSize(item.label, size);

  // Pack items into rows that fit.
  const rows = [];
  let row = [];
  let rowWidth = 0;
  for (const item of items) {
    const width = chipWidth(item);
    if (row.length && rowWidth + gap + width > available) {
      rows.push({ items: row, width: rowWidth });
      row = []; rowWidth = 0;
    }
    rowWidth += (row.length ? gap : 0) + width;
    row.push(item);
  }
  if (row.length) rows.push({ items: row, width: rowWidth });

  let cursorY = y;
  for (const line of rows) {
    let cursorX = align === 'right' && rightEdge != null ? rightEdge - line.width : x;
    for (const item of line.items) {
      page.drawRectangle({ x: cursorX, y: cursorY - 1, width: 7, height: 7, color: item.color });
      page.drawText(item.label, { x: cursorX + 10, y: cursorY, size, font: fonts.regular, color: PALETTE.muted });
      cursorX += chipWidth(item) + gap;
    }
    cursorY -= 11;
  }
  return cursorY - 3;
}

/** Horizontal proportion bars — compact alternative when space is tight. */
export function drawHorizontalBars(page, fonts, { x, y, width, rows, title, labelWidth = 96 }) {
  let cursorY = y;
  if (title) {
    page.drawText(title, { x, y: cursorY, size: 9, font: fonts.bold, color: PALETTE.ink });
    cursorY -= 16;
  }
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  const trackWidth = width - labelWidth - 34;

  rows.forEach((row, index) => {
    const value = Number(row.value) || 0;
    page.drawText(truncate(row.label, fonts.regular, 7.5, labelWidth - 6), {
      x, y: cursorY - 7, size: 7.5, font: fonts.regular, color: PALETTE.muted
    });
    page.drawRectangle({
      x: x + labelWidth, y: cursorY - 9, width: trackWidth, height: 9,
      color: PALETTE.surfaceAlt
    });
    page.drawRectangle({
      x: x + labelWidth, y: cursorY - 9,
      width: Math.max((value / max) * trackWidth, value > 0 ? 2 : 0), height: 9,
      color: row.color ?? SERIES_COLORS[index % SERIES_COLORS.length]
    });
    page.drawText(String(row.display ?? value), {
      x: x + labelWidth + trackWidth + 6, y: cursorY - 7.5,
      size: 7.5, font: fonts.bold, color: PALETTE.ink
    });
    cursorY -= 16;
  });
  return cursorY - 14;
}

/**
 * Data table with a tinted header, zebra rows and per-column alignment.
 * columns: [{ header, key, width, align }]
 */
export function drawTable(page, fonts, { x, y, width, columns, rows, maxRows = 40, emptyMessage = 'No records' }) {
  const rowHeight = 15;
  const headerHeight = 17;
  let cursorY = y;

  const totalDeclared = columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
  const columnWidths = columns.map((c) => ((c.width ?? 1) / totalDeclared) * width);

  page.drawRectangle({ x, y: cursorY - headerHeight, width, height: headerHeight, color: PALETTE.primarySoft });
  let cellX = x;
  columns.forEach((column, index) => {
    page.drawText(truncate(column.header, fonts.bold, 7.5, columnWidths[index] - 8), {
      x: cellX + 5, y: cursorY - headerHeight + 5.5, size: 7.5, font: fonts.bold, color: PALETTE.primary
    });
    cellX += columnWidths[index];
  });
  cursorY -= headerHeight;

  if (!rows.length) {
    page.drawRectangle({ x, y: cursorY - rowHeight, width, height: rowHeight, color: PALETTE.surface });
    page.drawText(emptyMessage, {
      x: x + 5, y: cursorY - rowHeight + 4.5, size: 7.5, font: fonts.regular, color: PALETTE.slate
    });
    return cursorY - rowHeight - 6;
  }

  rows.slice(0, maxRows).forEach((row, rowIndex) => {
    if (rowIndex % 2 === 1) {
      page.drawRectangle({ x, y: cursorY - rowHeight, width, height: rowHeight, color: PALETTE.surface });
    }
    cellX = x;
    columns.forEach((column, columnIndex) => {
      const raw = row[column.key];
      const text = truncate(raw == null || raw === '' ? '—' : String(raw), fonts.regular, 7.5, columnWidths[columnIndex] - 8);
      const textWidth = fonts.regular.widthOfTextAtSize(text, 7.5);
      const textX =
        column.align === 'right'
          ? cellX + columnWidths[columnIndex] - 5 - textWidth
          : column.align === 'center'
            ? cellX + columnWidths[columnIndex] / 2 - textWidth / 2
            : cellX + 5;
      page.drawText(text, { x: textX, y: cursorY - rowHeight + 4.5, size: 7.5, font: fonts.regular, color: PALETTE.ink });
      cellX += columnWidths[columnIndex];
    });
    page.drawLine({
      start: { x, y: cursorY - rowHeight }, end: { x: x + width, y: cursorY - rowHeight },
      thickness: 0.3, color: PALETTE.surfaceAlt
    });
    cursorY -= rowHeight;
  });

  if (rows.length > maxRows) {
    page.drawText(`+ ${rows.length - maxRows} more not shown`, {
      x, y: cursorY - 10, size: 7, font: fonts.regular, color: PALETTE.slate
    });
    cursorY -= 14;
  }
  return cursorY - 6;
}
