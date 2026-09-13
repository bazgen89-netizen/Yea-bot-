import { StyleSheet, View } from 'react-native';

import { web } from '../ui/webTheme';

/**
 * Полоска-график в шапке колонки отчёта.
 *
 * У него в отчётах по датам под названием каждой числовой колонки стоит
 * маленький график: видно, растёт колонка или падает, не читая столбец
 * целиком. Столбиками, а не линией — по той же причине, что и большой график
 * рядом: линию пришлось бы рисовать через SVG-библиотеку, а форма и так
 * читается.
 *
 * Высота 26 пикселей: больше — шапка начинает спорить с таблицей, меньше —
 * различить два соседних столбика уже нельзя.
 */
export function MiniChart({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const peak = Math.max(...values.map(Math.abs), 1);

  return (
    <View style={styles.chart}>
      {values.map((value, index) => (
        <View key={index} style={styles.slot}>
          <View
            style={[
              styles.bar,
              {
                // Единица снизу — чтобы нулевые дни остались видны полоской,
                // иначе в графике появляются дыры без объяснения.
                height: Math.max(1, Math.round((Math.abs(value) / peak) * 24)),
                backgroundColor: value < 0 ? web.danger : web.link,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 26,
    gap: 1,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  slot: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 1, opacity: 0.65 },
});
