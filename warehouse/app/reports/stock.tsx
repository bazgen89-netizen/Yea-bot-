import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { listLocations } from '../../src/db/locations';
import { stockQty, stockValue } from '../../src/db/reports';
import { рублиИкопейки } from '../../src/domain/reportFilter';
import { formatMoney } from '../../src/domain/money';
import { formatQtyTotal } from '../../src/domain/qty';
import { useQuery } from '../../src/state/DatabaseProvider';
import { useDesktop } from '../../src/ui/useDesktop';
import { colors, spacing } from '../../src/ui/theme';

/**
 * «Оценка склада» — то, что открывается с главной по кнопке «Подробнее».
 *
 * Кнопка была, а экрана не было: она вела на отчёт с именем `stock`, а
 * такого в реестре нет — и упиралась в «Такого отчёта нет». Ровно та же
 * беда, что была у четырёх плиток отчётов.
 *
 * Устроен не таблицей, а группами, как он прислал: сперва «Общие» по всем
 * магазинам, дальше по магазину на группу, и в каждой три строки —
 * количество, стоимость в розничных ценах и по себестоимости.
 *
 * Лежит отдельным файлом, а не записью в реестре отчётов: у отчётов там
 * колонки и строки, а здесь ни того ни другого — здесь девять чисел,
 * разложенных по группам.
 */
export default function StockValuationScreen() {
  const desktop = useDesktop();

  const магазины = useQuery((db) => listLocations(db), []);

  const общее = useQuery(
    (db) => ({ количество: stockQty(db, null), деньги: stockValue(db, null) }),
    [],
  );

  const поМагазинам = useQuery(
    (db) =>
      listLocations(db).map((место) => ({
        место,
        количество: stockQty(db, место.id),
        деньги: stockValue(db, место.id),
      })),
    [магазины.length],
  );

  return (
    <View style={стиль.экран}>
      <Stack.Screen options={{ title: 'Оценка склада' }} />

      <ScrollView contentContainerStyle={desktop ? стиль.широко : undefined}>
        <Группа имя="Общие">
          <Строка
            сверху="Общее"
            снизу="Количество товара"
            значение={`${formatQtyTotal(общее.количество)} ед.`}
          />
          <Строка
            сверху="Стоимость товара"
            снизу="В розничных ценах"
            деньги
            значение={formatMoney(общее.деньги.retailValue)}
          />
          <Строка
            сверху="Стоимость товара"
            снизу="По себестоимости"
            деньги
            значение={formatMoney(общее.деньги.costValue)}
            последняя
          />
        </Группа>

        {поМагазинам.map((один) => (
          <Группа key={один.место.id} имя={один.место.name}>
            <Строка
              сверху="Общее"
              снизу="Количество товара"
              значение={`${formatQtyTotal(один.количество)} ед.`}
            />
            <Строка
              сверху="Стоимость товара"
              снизу="В розничных ценах"
            деньги
              значение={formatMoney(один.деньги.retailValue)}
            />
            <Строка
              сверху="Стоимость товара"
              снизу="По себестоимости"
            деньги
              значение={formatMoney(один.деньги.costValue)}
              последняя
            />
          </Группа>
        ))}
      </ScrollView>
    </View>
  );
}

/** Синий заголовок и белый блок под ним, отделённый серой полосой. */
function Группа({ имя, children }: { имя: string; children: React.ReactNode }) {
  return (
    <>
      <Text style={стиль.заголовок}>{имя}</Text>
      <View style={стиль.блок}>{children}</View>
      <View style={стиль.полоса} />
    </>
  );
}

/**
 * Строка: мелкая серая подпись, под ней название, справа число.
 *
 * Две подписи, а не одна: у него сверху стоит, к чему число относится
 * («Стоимость товара»), а снизу — в чём оно считается («В розничных
 * ценах»). Одной строкой «Стоимость товара в розничных ценах» она не
 * помещается на телефоне и переносится посреди мысли.
 */
function Строка({
  сверху,
  снизу,
  значение,
  деньги,
  последняя,
}: {
  сверху: string;
  снизу: string;
  значение: string;
  /** Деньги или количество: красным он красит только деньги. */
  деньги?: boolean;
  последняя?: boolean;
}) {
  const [целое, дробь] = рублиИкопейки(значение.replace(' ед.', ''));
  const единицы = значение.endsWith(' ед.') ? ' ед.' : '';

  /*
   * Красным — только отрицательные деньги.
   *
   * У него «-912 678,72 ед.» набрано чёрным, а «-622 795,82» рядом —
   * красным. И это не небрежность: отрицательный остаток в штуках он
   * видит каждый день и знает, откуда тот берётся, а минус в деньгах
   * значит, что склад ушёл в долг, — и вот это надо заметить.
   */
  const минус = Boolean(деньги) && целое.startsWith('-');

  return (
    <View style={[стиль.строка, последняя && стиль.безЧерты]}>
      <View style={стиль.подписи}>
        <Text style={стиль.сверху}>{сверху}</Text>
        <Text style={стиль.снизу}>{снизу}</Text>
      </View>
      <Text style={[стиль.значение, минус && стиль.минус]} numberOfLines={1}>
        {целое}
        <Text style={[стиль.дробь, минус && стиль.минусДробь]}>{дробь}</Text>
        <Text style={стиль.единицы}>{единицы}</Text>
      </Text>
    </View>
  );
}

const стиль = StyleSheet.create({
  экран: { flex: 1, backgroundColor: colors.surface },
  широко: { maxWidth: 720, width: '100%', alignSelf: 'center' },

  заголовок: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.accent,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  блок: { backgroundColor: colors.surface },
  полоса: { height: 12, backgroundColor: colors.bg },

  строка: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  безЧерты: { borderBottomWidth: 0 },

  подписи: { flex: 1 },
  сверху: { fontSize: 14, color: colors.textMuted },
  снизу: { fontSize: 18, color: colors.text, marginTop: 1 },

  значение: {
    fontSize: 21,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  дробь: { color: colors.textMuted },
  единицы: { fontSize: 18, color: colors.textMuted },
  минус: { color: colors.danger },
  минусДробь: { color: colors.danger, opacity: 0.55 },
});
