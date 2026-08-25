import { useState } from 'react';
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Translated';

import { scaleFor, smooth, spaced } from '../domain/chart';
import { formatMoneyWeb } from '../domain/money';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * График выручки по дням — сглаженной линией с заливкой, как у него.
 *
 * До этого он рисовался столбиками: линию в `react-native-web` пришлось бы
 * рисовать через SVG, а тянуть ради этого библиотеку не хотелось. Но он
 * прислал снимок своего графика, и дело не в красоте: по его графику **водят
 * мышью** и смотрят, сколько наторговали в конкретный день. Столбики этого
 * не умеют.
 *
 * SVG здесь не из библиотеки, а прямой: экраны кабинета рисует react-dom, и
 * `<svg>` в нём — обычный тег. На телефоне такого тега нет, поэтому там
 * остаются столбики: платформа проверяется явно.
 */
export function Chart({ points, days }: { points: number[]; days: number }) {
  const values = Array.from({ length: days }, (_, i) => points[i] ?? 0);

  // Ось размечается круглыми числами: у него это 0, 10 000, 20 000 … 60 000
  // при вершине 46 501. Просто поделить вершину на пять — значит подписать
  // ось числами вида «9 300», а таких на его графике нет.
  const { top: peak, ticks } = scaleFor(Math.max(...values, 1));
  const labelStep = stepFor(days);

  const [width, setWidth] = useState(0);
  /** День под курсором. Кликнутый остаётся, пока не кликнут другой. */
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;

  const measure = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.chart}>
      <View style={styles.axis}>
        {ticks.map((tick, index) => (
          <Text key={index} style={styles.tick}>
            {formatMoneyWeb(tick).replace('.00', '')}
          </Text>
        ))}
      </View>

      <View style={styles.plot}>
        <View style={styles.area} onLayout={measure}>
          {Platform.OS === 'web' && width > 0 ? (
            <Curve
              values={values}
              peak={peak}
              width={width}
              height={PLOT_HEIGHT}
              active={active}
              lines={ticks.length}
              onHover={setHover}
              onPick={(index) => setPinned((was) => (was === index ? null : index))}
            />
          ) : (
            <Bars values={values} peak={peak} ticks={ticks.length} />
          )}
        </View>

        {/* Числа под графиком нажимаются: нажал день — на графике встала
            его выручка, как по самой линии. Раньше они были синими и
            молчали, а синее, что не нажимается, обещает переход, которого
            нет. Синим отмечена каждая седьмая метка — это его разметка
            недель, а не ссылки. */}
        <View style={styles.days}>
          {values.map((_, index) => (
            <Pressable
              key={index}
              accessibilityRole="button"
              accessibilityLabel={`День ${index + 1}`}
              style={styles.dayCell}
              onPress={() => setPinned((was) => (was === index ? null : index))}
            >
              <Text
                style={[
                  styles.day,
                  isMarked(index + 1) && styles.dayMarked,
                  active === index && styles.dayActive,
                ]}
              >
                {index % labelStep === 0 ? index + 1 : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const PLOT_HEIGHT = 254;

/** Сглаженная линия с заливкой и подписью под курсором. */
function Curve({
  values,
  peak,
  width,
  height,
  active,
  lines,
  onHover,
  onPick,
}: {
  values: number[];
  peak: number;
  width: number;
  height: number;
  active: number | null;
  /** Сколько горизонтальных линий — столько же, сколько подписей на оси. */
  lines: number;
  onHover: (index: number | null) => void;
  onPick: (index: number) => void;
}) {
  // Отступы, чтобы кружок крайнего дня не срезался краем картинки.
  const pad = 6;
  const inner = Math.max(1, width - pad * 2);
  const step = values.length > 1 ? inner / (values.length - 1) : 0;

  const x = (index: number) => pad + index * step;
  const y = (value: number) => height - (value / peak) * height;

  const line = smooth(values.map((value, index) => [x(index), y(value)]));
  const fill = `${line} L ${x(values.length - 1)} ${height} L ${x(0)} ${height} Z`;

  /** Ближайший день к точке, куда попала мышь. */
  const dayAt = (offsetX: number) =>
    Math.max(0, Math.min(values.length - 1, Math.round((offsetX - pad) / (step || 1))));

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', cursor: 'pointer' }}
      onMouseMove={(event: { nativeEvent: { offsetX: number } }) =>
        onHover(dayAt(event.nativeEvent.offsetX))
      }
      onMouseLeave={() => onHover(null)}
      onClick={(event: { nativeEvent: { offsetX: number } }) =>
        onPick(dayAt(event.nativeEvent.offsetX))
      }
    >
      {Array.from({ length: lines }, (_, index) => (
        <line
          key={`h${index}`}
          x1={0}
          x2={width}
          y1={(height / (lines - 1)) * index}
          y2={(height / (lines - 1)) * index}
          stroke="#EFEFEF"
        />
      ))}

      {values.map((_, index) =>
        index % 5 === 0 ? (
          <line
            key={`v${index}`}
            x1={x(index)}
            x2={x(index)}
            y1={0}
            y2={height}
            stroke="#F4F4F4"
          />
        ) : null,
      )}

      <path d={fill} fill="#D6EBF9" />
      <path d={line} fill="none" stroke="#5BA7DC" strokeWidth={2} />

      {values.map((value, index) => (
        <circle key={index} cx={x(index)} cy={y(value)} r={2.5} fill="#5BA7DC" />
      ))}

      {active !== null ? (
        <g>
          <line
            x1={x(active)}
            x2={x(active)}
            y1={y(values[active])}
            y2={height}
            stroke="#2F80C8"
            strokeDasharray="4 4"
          />
          <circle
            cx={x(active)}
            cy={y(values[active])}
            r={6}
            fill="#FFFFFF"
            stroke="#2F80C8"
            strokeWidth={3}
          />
          <text
            x={x(active) + (active > values.length - 5 ? -14 : 14)}
            y={y(values[active]) + 5}
            textAnchor={active > values.length - 5 ? 'end' : 'start'}
            fontSize={15}
            fontWeight={600}
            fill="#3A3A3A"
            fontFamily={WEB_FONT}
          >
            {spaced(values[active])}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** Запасной вид для телефона: там `<svg>` рисовать нечем. */
function Bars({ values, peak, ticks }: { values: number[]; peak: number; ticks: number }) {
  return (
    <>
      <View style={styles.grid}>
        {Array.from({ length: ticks }, (_, index) => (
          <View key={index} style={styles.gridLine} />
        ))}
      </View>

      <View style={styles.bars}>
        {values.map((value, index) => (
          <View key={index} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${(value / peak) * 100}%` }]} />
          </View>
        ))}
      </View>
    </>
  );
}

/**
 * Через сколько столбцов подписывать ось.
 *
 * За месяц подписан каждый день — как в оригинале. За квартал и год подписи
 * встали бы друг на друга и превратились в серую кашу, поэтому прореживаются
 * до тех же примерно тридцати отметок.
 */
function stepFor(days: number): number {
  return Math.max(1, Math.ceil(days / 31));
}

/** Числа 2, 9, 16, 23, 30 выделены — по ним в исходном приложении идёт неделя. */
function isMarked(day: number): boolean {
  return day % 7 === 2;
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', height: 280, gap: 10 },
  axis: { width: 58, justifyContent: 'space-between', paddingBottom: 26 },
  /**
   * Подписи оси — их же: `.dashboard #dashboard-chart .axis text
   * { font-size: 12px; fill: #B0B0B0; font-weight: 300 }`, а у оси дней
   * `.axis.x text { font-size: 10px }`. У меня стояло 12 и 11 обычным
   * начертанием, и ось выходила темнее и тяжелее его.
   */
  tick: {
    fontFamily: WEB_FONT,
    fontSize: 12,
    color: '#B0B0B0',
    fontWeight: '300' as const,
    textAlign: 'right',
  },
  plot: { flex: 1 },
  area: { height: PLOT_HEIGHT },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
  },
  gridLine: { height: 1, backgroundColor: '#EFEFEF' },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  // Ограничение ширины нужно для периода «сегодня»: один столбец на всю
  // ширину графика выглядел бы залитой плашкой, а не данными.
  barSlot: { flex: 1, maxWidth: 60, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: '#BBDEFB', borderTopWidth: 2, borderTopColor: '#42A5F5', minHeight: 1 },
  days: { flexDirection: 'row', gap: 2, height: 26, alignItems: 'center' },
  dayCell: { flex: 1 },
  day: { fontFamily: WEB_FONT, fontSize: 10, color: '#B0B0B0', fontWeight: '300' as const, textAlign: 'center' },
  dayMarked: { color: web.link },
  dayActive: { color: web.text, fontWeight: '700' },
});
