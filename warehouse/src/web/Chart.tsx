import { StyleSheet, Text, View } from 'react-native';

import { formatMoneyWeb } from '../domain/money';
import { web } from '../ui/webTheme';

/**
 * График выручки по дням месяца.
 *
 * Столбцами, а не линией: линию в `react-native-web` пришлось бы рисовать
 * через SVG-библиотеку, а ради одного графика тянуть зависимость и утяжелять
 * страницу на пару сотен килобайт незачем — форма и подписи те же.
 */
export function Chart({ points, days }: { points: number[]; days: number }) {
  const values = Array.from({ length: days }, (_, i) => points[i] ?? 0);
  const peak = Math.max(...values, 1);

  // Подписи оси: пять ровных делений от нуля до вершины.
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((peak / 4) * (4 - i)));

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
        <View style={styles.grid}>
          {ticks.map((_, index) => (
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

        <View style={styles.days}>
          {values.map((_, index) => (
            <Text key={index} style={[styles.day, isMarked(index + 1) && styles.dayMarked]}>
              {index + 1}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Числа 2, 9, 16, 23, 30 выделены — по ним в исходном приложении идёт неделя. */
function isMarked(day: number): boolean {
  return day % 7 === 2;
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', height: 280, gap: 10 },
  axis: { width: 58, justifyContent: 'space-between', paddingBottom: 26 },
  tick: { fontSize: 12, color: web.textMuted, textAlign: 'right' },
  plot: { flex: 1 },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 26, justifyContent: 'space-between' },
  gridLine: { height: 1, backgroundColor: '#EFEFEF' },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: '#BBDEFB', borderTopWidth: 2, borderTopColor: '#42A5F5', minHeight: 1 },
  days: { flexDirection: 'row', gap: 2, height: 26, alignItems: 'center' },
  day: { flex: 1, fontSize: 11, color: web.textMuted, textAlign: 'center' },
  dayMarked: { color: web.link },
});
