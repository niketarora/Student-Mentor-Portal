/**
 * Charts.jsx
 * Thin, themed wrappers around Recharts so every chart in the three
 * portals shares the same palette, tooltip style and empty state.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants.js';
import { TILT_DEGREES, categoryAxisLayout, fitLabel } from './categoryAxis.js';

const AXIS = { stroke: '#a8a29e', fontSize: 11, tickLine: false };
const GRID = { stroke: '#f0e4dc', strokeDasharray: '3 3', vertical: false };

const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 12,
    border: '1px solid #f2e4dc',
    boxShadow: '0 12px 32px rgba(28,25,23,0.12)',
    fontSize: 12,
    fontFamily: 'Hanken Grotesk, sans-serif'
  },
  labelStyle: { fontWeight: 600, color: '#1c1917' }
};

function ChartFrame({ title, subtitle, height = 260, isEmpty, emptyLabel, children, actions }) {
  return (
    <div className="flex h-full flex-col">
      {(title || actions) && (
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-label-md text-on-surface">{title}</h3>}
            {subtitle && <p className="text-label-sm text-tertiary">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {isEmpty ? (
        <div
          className="flex items-center justify-center rounded border border-dashed border-outline-variant bg-surface-container-low text-body-sm text-tertiary"
          style={{ height }}
        >
          {emptyLabel ?? 'No data to display yet'}
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** The chart's own width, for laying out its axis labels. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** A category label: level under its bar, or tilted when it is wider than the bar's slot. */
function CategoryTick({ x, y, payload, tilted, maxLabel }) {
  const label = fitLabel(payload?.value, maxLabel);
  if (!tilted) {
    return (
      <text x={x} y={y} dy={12} textAnchor="middle" fill={AXIS.stroke} fontSize={AXIS.fontSize}>
        {label}
      </text>
    );
  }
  return (
    <text x={x} y={y} dy={8} textAnchor="end" fill={AXIS.stroke} fontSize={AXIS.fontSize}
      transform={`rotate(-${TILT_DEGREES}, ${x}, ${y})`}>
      {label}
    </text>
  );
}

/**
 * Vertical bars, one colour per bar (each entry's `color`, else the series
 * palette in order). With `allLabels`, every bar keeps its name, tilted
 * when the panel is too narrow for it; otherwise Recharts drops labels that
 * would overlap.
 */
export function CategoryBarChart({ data, title, subtitle, height = 260, dataKey = 'value', nameKey = 'name', allLabels = false }) {
  const isEmpty = !data?.length || data.every((d) => !d[dataKey]);
  const [ref, width] = useWidth();
  const axis = categoryAxisLayout(allLabels ? (data ?? []).map((d) => d[nameKey]) : [], width);
  const xAxis = allLabels
    ? { interval: 0, height: axis.axisHeight, tick: <CategoryTick tilted={axis.tilted} maxLabel={axis.maxLabel} /> }
    : {};
  return (
    <div ref={ref} className="h-full">
      <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey={nameKey} {...AXIS} axisLine={false} {...xAxis} />
          <YAxis {...AXIS} axisLine={false} allowDecimals={false} />
          <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(194,65,12,0.06)' }} />
          <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} maxBarSize={56}>
            {data.map((entry, index) => (
              <Cell key={entry[nameKey]} fill={entry.color ?? CHART_COLORS.series[index % CHART_COLORS.series.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
    </div>
  );
}

export function GroupedBarChart({ data, series, title, subtitle, height = 280, xKey = 'name' }) {
  const isEmpty = !data?.length;
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} axisLine={false} />
        <YAxis {...AXIS} axisLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: 'rgba(194,65,12,0.06)' }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={26} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function TrendLineChart({ data, title, subtitle, height = 260, xKey = 'name', lines, domain }) {
  const isEmpty = !data?.length;
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <LineChart data={data} margin={{ top: 8, right: 14, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} axisLine={false} />
        <YAxis {...AXIS} axisLine={false} domain={domain ?? [0, 'auto']} allowDecimals={Boolean(domain)} />
        <Tooltip {...TOOLTIP_STYLE} />
        {lines.length > 1 && <Legend iconType="line" wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />}
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeWidth={2.4}
            dot={{ r: 3.5, strokeWidth: 0, fill: line.color }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function AreaTrendChart({ data, title, subtitle, height = 220, xKey = 'name', areaKey = 'value', color = CHART_COLORS.primary, label }) {
  const isEmpty = !data?.length;
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={isEmpty}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={`area-${areaKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={xKey} {...AXIS} axisLine={false} />
        <YAxis {...AXIS} axisLine={false} allowDecimals={false} />
        <Tooltip {...TOOLTIP_STYLE} />
        <Area
          type="monotone"
          dataKey={areaKey}
          name={label ?? areaKey}
          stroke={color}
          strokeWidth={2.2}
          fill={`url(#area-${areaKey})`}
        />
      </AreaChart>
    </ChartFrame>
  );
}

export function DonutChart({ data, title, subtitle, height = 260, centerLabel, centerValue }) {
  const total = (data ?? []).reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={total === 0}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={1.5}
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={entry.color ?? CHART_COLORS.series[index % CHART_COLORS.series.length]} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP_STYLE} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <text x="50%" y="44%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fontWeight: 700, fill: '#1c1917' }}>
          {centerValue ?? total}
        </text>
        <text x="50%" y="53%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: '#a8a29e' }}>
          {centerLabel ?? 'total'}
        </text>
      </PieChart>
    </ChartFrame>
  );
}

export function GaugeChart({ value, max = 100, title, subtitle, label, color = CHART_COLORS.primary, height = 200 }) {
  const clamped = Math.max(0, Math.min(Number(value) || 0, max));
  return (
    <ChartFrame title={title} subtitle={subtitle} height={height} isEmpty={false}>
      <RadialBarChart
        innerRadius="68%"
        outerRadius="100%"
        data={[{ name: label, value: clamped, fill: color }]}
        startAngle={210}
        endAngle={-30}
      >
        <PolarAngleAxis type="number" domain={[0, max]} angleAxisId={0} tick={false} />
        <RadialBar background={{ fill: '#f5e9e2' }} dataKey="value" cornerRadius={8} />
        <text x="50%" y="52%" textAnchor="middle" style={{ fontSize: 24, fontWeight: 700, fill: '#1c1917' }}>
          {clamped}
          {max === 100 ? '%' : ''}
        </text>
        <text x="50%" y="65%" textAnchor="middle" style={{ fontSize: 11, fill: '#a8a29e' }}>
          {label}
        </text>
      </RadialBarChart>
    </ChartFrame>
  );
}

/** Compact inline sparkline for stat cards. */
export function Sparkline({ data, color = CHART_COLORS.primary, height = 44 }) {
  if (!data?.length) return null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
