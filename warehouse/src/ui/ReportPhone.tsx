import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { counterpartyNames } from '../db/counterparties';
import { listLocations } from '../db/locations';
import { periodFor } from '../db/reports';
import type { ReportDefinition } from '../db/reportTypes';
import { listStaff } from '../db/staff';
import {
  естьОтбор,
  подписьПериода,
  день,
  периодИз,
  ячейкаОтчёта,
  ПУСТОЙ_ОТБОР,
  type ОтборОтчёта,
} from '../domain/reportFilter';
import { ОкноДаты } from './ОкноДаты';
import { useQuery } from '../state/DatabaseProvider';
import { colors, spacing } from './theme';

/**
 * Отчёт на телефоне — по снимку, который прислал Вазген.
 *
 * До этого на телефоне открывался экран кабинета: панель с выпадающими
 * списками и таблица в семь колонок, которую приходилось листать вбок. У
 * него не так. Сверху лента фишек — «Дата», «Параметр», «Сотрудник»,
 * «Магазин», «Очистить», — под ней две колонки, а внизу закреплён итог:
 * «Итог (30 позиций)» и сумма.
 *
 * Две колонки, а не семь, потому что на телефоне седьмую всё равно не
 * увидеть. Какая из числовых колонок показана — выбирается фишкой
 * «Параметр»: у него там «Выручка», и переключается она туда же.
 */

/** Сколько строк рисуем разом. Больше телефону не нужно, а список длинный. */
const ПОРЦИЯ = 60;

interface Выбор {
  /** Что показываем во второй колонке — номер колонки отчёта. */
  колонка: number;
  /**
   * Границы периода местными датами, «2026-09-01».
   *
   * Раньше здесь лежало одно слово — «месяц», «год». Но в его окне «Дата»
   * период набирается колёсиком по числам, и словом такой не назвать.
   */
  от: string;
  до: string;
  отбор: ОтборОтчёта;
}

/** Соседний отчёт: кнопка внизу экрана. */
export interface Сосед {
  id: string;
  title: string;
  значок: string;
  фон: string;
  цвет: string;
}

export function ReportPhone({
  report,
  соседние = [],
}: {
  report: ReportDefinition;
  /**
   * Отчёты, кнопки на которые стоят внизу. У «дней» это «недели», у
   * «товаров» — «по месяцам» и «по комплектам»: у него их там два.
   */
  соседние?: Сосед[];
}) {
  const router = useRouter();

  const [выбор, задать] = useState<Выбор>(() => {
    // Открывается на текущем месяце — так же, как открывался раньше.
    const месяц = periodFor('month');
    return {
      // Первая числовая колонка — «Сумма продаж», она же его «Выручка».
      колонка: Math.max(1, report.columns.findIndex((c) => c.numeric)),
      от: день(new Date(месяц.from)),
      до: день(new Date(месяц.to)),
      отбор: ПУСТОЙ_ОТБОР,
    };
  });

  /** Какое окошко выбора открыто. */
  const [окно, открыть] = useState<
    null | 'дата' | 'параметр' | 'сотрудник' | 'магазин' | 'клиент'
  >(null);
  const [сколько, показать] = useState(ПОРЦИЯ);

  // По какой колонке и в какую сторону. У него отчёт по товарам открыт по
  // алфавиту — стрелка вверх у «Наименования».
  const [сортировка, сортировать] = useState({ колонка: 0, вверх: true });

  const период = useMemo(() => периодИз(выбор.от, выбор.до), [выбор.от, выбор.до]);

  const строки = useQuery(
    (db) => report.rows(db, период, выбор.отбор),
    [report.id, период.from, период.to, выбор.отбор.место, выбор.отбор.сотрудник, выбор.отбор.клиент],
  );
  const итог = useQuery(
    (db) => (report.total ? report.total(db, период, выбор.отбор) : null),
    [report.id, период.from, период.to, выбор.отбор.место, выбор.отбор.сотрудник, выбор.отбор.клиент],
  );

  const магазины = useQuery((db) => listLocations(db), []);
  const сотрудники = useQuery((db) => listStaff(db), []);
  // Покупателей три тысячи, поэтому окно клиента — с поиском.
  const клиенты = useQuery(
    (db) => (report.отборКлиента ? counterpartyNames(db, 'customer') : []),
    [report.отборКлиента],
  );

  const числовые = report.columns
    .map((колонка, номер) => ({ колонка, номер }))
    .filter(({ колонка }) => колонка.numeric);

  const имяМагазина =
    выбор.отбор.место === null
      ? null
      : (магазины.find((один) => один.id === выбор.отбор.место)?.name ?? null);
  const имяСотрудника =
    выбор.отбор.сотрудник === null
      ? null
      : (сотрудники.find((один) => один.id === выбор.отбор.сотрудник)?.name ?? null);
  const имяКлиента =
    выбор.отбор.клиент === null
      ? null
      : (клиенты.find((один) => один.id === выбор.отбор.клиент)?.name ?? null);

  /*
   * Порядок строк. У него шапка «Наименование» со стрелкой вверх, и список
   * идёт по алфавиту; нажатие переворачивает. Числовую колонку он тоже
   * сортирует — по ней отчёт и открывается.
   *
   * Сортируем уже готовые строки, а не запрос: строка отчёта — это текст,
   * и второй порядок в SQL пришлось бы держать для каждого из одиннадцати
   * отчётов отдельно.
   */
  const упорядочены = useMemo(() => {
    const копия = [...строки];
    const по = сортировка.колонка;
    const знак = сортировка.вверх ? 1 : -1;

    копия.sort((а, б) => {
      const левое = а[по] ?? '';
      const правое = б[по] ?? '';
      if (report.columns[по]?.numeric) {
        return (число(левое) - число(правое)) * знак;
      }
      return левое.localeCompare(правое, 'ru') * знак;
    });
    return копия;
  }, [строки, сортировка.колонка, сортировка.вверх, report.id]);

  const видно = упорядочены.slice(0, сколько);
  const [рубли, копейки] = ячейкаОтчёта(String(итог?.[выбор.колонка] ?? ''));

  return (
    <View style={стиль.экран}>
      {/* Лента фишек. Она листается вбок: у него «Магазин» и «Очистить»
          видны только после прокрутки, и это нормально — важнейшие слева. */}
      <View style={стиль.лента}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={стиль.лентаТело}>
          <Фишка
            подпись="Дата"
            значение={подписьПериода(период.from, период.to)}
            onPress={() => открыть('дата')}
          />
          <Фишка
            подпись="Параметр"
            значение={report.columns[выбор.колонка]?.title ?? '—'}
            onPress={() => открыть('параметр')}
          />
          <Фишка
            подпись="Сотрудник"
            значение={имяСотрудника ?? 'все'}
            onPress={() => открыть('сотрудник')}
          />
          {report.отборКлиента ? (
            <Фишка
              подпись="Клиент"
              значение={имяКлиента ?? 'все'}
              onPress={() => открыть('клиент')}
            />
          ) : null}
          <Фишка
            подпись="Магазин"
            значение={имяМагазина ?? 'все'}
            onPress={() => открыть('магазин')}
          />
          {естьОтбор(выбор.отбор) ? (
            <Pressable
              accessibilityRole="button"
              style={стиль.чистить}
              onPress={() => задать((было) => ({ ...было, отбор: ПУСТОЙ_ОТБОР }))}
            >
              <Text style={стиль.чиститьТекст}>Очистить</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>

      {/* Шапка таблицы — она же переключатель порядка: нажатие по названию
          колонки сортирует по ней, повторное переворачивает. */}
      <View style={стиль.шапка}>
        <Загловок
          имя={report.columns[0]?.title ?? 'Наименование'}
          своя={сортировка.колонка === 0}
          вверх={сортировка.вверх}
          слева
          onPress={() =>
            сортировать((было) => ({ колонка: 0, вверх: было.колонка === 0 ? !было.вверх : true }))
          }
        />
        <Загловок
          имя={report.columns[выбор.колонка]?.title ?? ''}
          своя={сортировка.колонка === выбор.колонка}
          вверх={сортировка.вверх}
          onPress={() =>
            сортировать((было) => ({
              колонка: выбор.колонка,
              вверх: было.колонка === выбор.колонка ? !было.вверх : false,
            }))
          }
        />
      </View>

      <ScrollView
        onScroll={({ nativeEvent: н }) => {
          const дно = н.contentOffset.y + н.layoutMeasurement.height >= н.contentSize.height - 400;
          if (дно && сколько < строки.length) показать((было) => было + ПОРЦИЯ);
        }}
        scrollEventThrottle={200}
      >
        {видно.map((строка, номер) => {
          const [целое, дробь] = ячейкаОтчёта(строка[выбор.колонка] ?? '');
          return (
            <View key={номер} style={стиль.строка}>
              <Text style={стиль.название} numberOfLines={2}>
                {строка[0]}
              </Text>
              {/* Копейки бледнее: у него в каждой строке «785,52» — рубли
                  чёрные, копейки серые. */}
              <Text style={стиль.значение} numberOfLines={1}>
                {целое}
                <Text style={стиль.копейки}>{дробь}</Text>
              </Text>
            </View>
          );
        })}

        {строки.length === 0 ? (
          <Text style={стиль.пусто}>За выбранный период данных нет</Text>
        ) : null}
      </ScrollView>

      {/* Итог закреплён внизу: у него он виден всегда, а не в конце списка. */}
      {итог ? (
        <View style={стиль.итог}>
          <Text style={стиль.итогПодпись}>Итог ({строки.length} позиций)</Text>
          <Text style={стиль.итогСумма}>
            {рубли}
            <Text style={стиль.итогКопейки}>{копейки}</Text>
          </Text>
        </View>
      ) : null}

      {/* Соседние отчёты. У «Продаж по товарам» их внизу два — «по месяцам»
          и «по комплектам», — поэтому это список, а не одна кнопка. */}
      {соседние.length ? (
        <View style={стиль.соседи}>
          {соседние.map((сосед) => (
            <Pressable
              key={сосед.id}
              accessibilityRole="button"
              style={стиль.сосед}
              onPress={() =>
                router.replace({ pathname: '/reports/[type]', params: { type: сосед.id } })
              }
            >
              <View style={[стиль.соседЗначок, { backgroundColor: сосед.фон }]}>
                <Text style={[стиль.соседЗначокТекст, { color: сосед.цвет }]}>{сосед.значок}</Text>
              </View>
              <Text style={стиль.соседТекст} numberOfLines={2}>
                {сосед.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ОкноДаты
        открыто={окно === 'дата'}
        от={выбор.от}
        до={выбор.до}
        закрыть={() => открыть(null)}
        применить={(от, до) => задать((было) => ({ ...было, от, до }))}
      />

      <Окно
        открыто={окно === 'параметр'}
        заголовок="Параметр"
        строки={числовые.map(({ колонка, номер }) => ({ ключ: String(номер), имя: колонка.title }))}
        выбрано={String(выбор.колонка)}
        закрыть={() => открыть(null)}
        выбрать={(ключ) => задать((было) => ({ ...было, колонка: Number(ключ) }))}
      />

      <Окно
        открыто={окно === 'сотрудник'}
        заголовок="Сотрудник"
        строки={[
          { ключ: 'все', имя: 'Все сотрудники' },
          ...сотрудники.map((один) => ({ ключ: String(один.id), имя: один.name })),
        ]}
        выбрано={выбор.отбор.сотрудник === null ? 'все' : String(выбор.отбор.сотрудник)}
        закрыть={() => открыть(null)}
        выбрать={(ключ) =>
          задать((было) => ({
            ...было,
            отбор: { ...было.отбор, сотрудник: ключ === 'все' ? null : Number(ключ) },
          }))
        }
      />

      <Окно
        открыто={окно === 'клиент'}
        заголовок="Клиент"
        сПоиском
        строки={[
          { ключ: 'все', имя: 'Все клиенты' },
          ...клиенты.map((один) => ({ ключ: String(один.id), имя: один.name })),
        ]}
        выбрано={выбор.отбор.клиент === null ? 'все' : String(выбор.отбор.клиент)}
        закрыть={() => открыть(null)}
        выбрать={(ключ) =>
          задать((было) => ({
            ...было,
            отбор: { ...было.отбор, клиент: ключ === 'все' ? null : Number(ключ) },
          }))
        }
      />

      <Окно
        открыто={окно === 'магазин'}
        заголовок="Магазин"
        строки={[
          { ключ: 'все', имя: 'Все магазины' },
          ...магазины.map((один) => ({ ключ: String(один.id), имя: один.name })),
        ]}
        выбрано={выбор.отбор.место === null ? 'все' : String(выбор.отбор.место)}
        закрыть={() => открыть(null)}
        выбрать={(ключ) =>
          задать((было) => ({
            ...было,
            отбор: { ...было.отбор, место: ключ === 'все' ? null : Number(ключ) },
          }))
        }
      />
    </View>
  );
}

/**
 * Фишка отбора: серая таблетка, подпись тёмная, значение оранжевое.
 *
 * Оранжевым у него набрано именно выбранное значение — по ленте сразу
 * видно, что отобрано, не вчитываясь в подписи.
 */
function Фишка({
  подпись,
  значение,
  onPress,
}: {
  подпись: string;
  значение: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${подпись}: ${значение}`}
      style={стиль.фишка}
      onPress={onPress}
    >
      <Text style={стиль.фишкаПодпись}>
        {подпись} <Text style={стиль.фишкаЗначение}>{значение}</Text>
      </Text>
    </Pressable>
  );
}

/**
 * Заголовок колонки со стрелкой порядка.
 *
 * Стрелка стоит только у той колонки, по которой сейчас отсортировано —
 * у него так же: две стрелки разом сбивали бы с толку, по какой из них
 * список на самом деле построен.
 */
function Загловок({
  имя,
  своя,
  вверх,
  слева,
  onPress,
}: {
  имя: string;
  своя: boolean;
  вверх: boolean;
  слева?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Сортировать по «${имя}»`}
      style={[стиль.заголовок, слева && стиль.заголовокСлева]}
      onPress={onPress}
      hitSlop={8}
    >
      <Text style={стиль.заголовокТекст}>{имя}</Text>
      {своя ? <Text style={стиль.стрелка}>{вверх ? '⌃' : '⌄'}</Text> : null}
    </Pressable>
  );
}

/** Окошко выбора — список снизу, как у него. */
function Окно({
  открыто,
  заголовок,
  строки,
  выбрано,
  закрыть,
  выбрать,
  сПоиском,
}: {
  открыто: boolean;
  заголовок: string;
  строки: { ключ: string; имя: string }[];
  выбрано: string;
  закрыть: () => void;
  выбрать: (ключ: string) => void;
  /** Список клиентов — три тысячи строк, без поиска в нём не найти. */
  сПоиском?: boolean;
}) {
  const [искомое, искать] = useState('');

  /*
   * Больше сотни строк разом не рисуем.
   *
   * Клиентов 3 272. В браузере на этой машине окно открывается за 79 мс и
   * без предела — замерено, — но у него телефон, а не эта машина, и три
   * тысячи нажимаемых строк там обойдутся дороже. Листать их всё равно
   * никто не станет: нужного ищут поиском, он отзывается за 42 мс.
   */
  const ПРЕДЕЛ = 100;

  const подходящие = сПоиском && искомое.trim()
    ? строки.filter((один) => один.имя.toLowerCase().includes(искомое.trim().toLowerCase()))
    : строки;

  const отобранные = подходящие.slice(0, ПРЕДЕЛ);
  const спрятано = подходящие.length - отобранные.length;

  return (
    <Modal visible={открыто} transparent animationType="slide" onRequestClose={закрыть}>
      <Pressable style={стиль.тень} onPress={закрыть}>
        {/* Нажатие по самому листу не должно его закрывать. */}
        <Pressable style={стиль.лист} onPress={() => {}}>
          <Text style={стиль.листЗаголовок}>{заголовок}</Text>
          {сПоиском ? (
            <TextInput
              style={стиль.поиск}
              value={искомое}
              onChangeText={искать}
              placeholder="Поиск"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
            />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled">
            {отобранные.map((один) => (
              <Pressable
                key={один.ключ}
                accessibilityRole="button"
                accessibilityState={{ selected: один.ключ === выбрано }}
                style={стиль.пункт}
                onPress={() => {
                  выбрать(один.ключ);
                  закрыть();
                }}
              >
                <Text
                  style={[стиль.пунктТекст, один.ключ === выбрано && стиль.пунктВыбран]}
                  numberOfLines={2}
                >
                  {один.имя}
                </Text>
                {один.ключ === выбрано ? <Text style={стиль.галка}>✓</Text> : null}
              </Pressable>
            ))}

            {/* Молча обрезать список нельзя: человек пролистает до конца и
                решит, что его клиента в программе нет. */}
            {спрятано > 0 ? (
              <Text style={стиль.ещё}>
                Показаны первые {отобранные.length}. Ещё {спрятано} — найдите поиском.
              </Text>
            ) : null}

            {подходящие.length === 0 ? (
              <Text style={стиль.ещё}>Никто не найден</Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Число из готовой ячейки: «26,525.60» и «894%» — в 26525.6 и 894.
 *
 * Ячейки отчёта — уже текст, второго, «сырого» набора значений рядом нет.
 * Держать его значило бы иметь два источника правды об одном столбце.
 */
function число(ячейка: string): number {
  const чистое = ячейка.replace(/[\s,%]/g, '');
  const значение = Number(чистое);
  return Number.isFinite(значение) ? значение : 0;
}

/** Оранжевый значения на фишке — его собственный, снят со снимка. */
const ОРАНЖЕВЫЙ = '#E8500A';

const стиль = StyleSheet.create({
  экран: { flex: 1, backgroundColor: colors.surface },

  лента: { backgroundColor: colors.surface },
  лентаТело: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  фишка: {
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  фишкаПодпись: { fontSize: 15, color: colors.text },
  фишкаЗначение: { fontWeight: '700', color: ОРАНЖЕВЫЙ },
  чистить: {
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  чиститьТекст: { fontSize: 15, color: colors.text },

  шапка: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  заголовок: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  заголовокСлева: { flex: 1 },
  заголовокТекст: { fontSize: 15, color: colors.textMuted },
  стрелка: { fontSize: 15, color: colors.textMuted, lineHeight: 18 },

  строка: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  название: { flex: 1, fontSize: 17, color: colors.text },
  значение: { fontSize: 17, color: colors.text, fontVariant: ['tabular-nums'] },
  // Копейки бледнее рублей — так у него в каждой строке отчёта.
  копейки: { color: colors.textMuted },

  пусто: { padding: spacing.xl, fontSize: 15, color: colors.textMuted, textAlign: 'center' },

  итог: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.md,
  },
  итогПодпись: { flex: 1, fontSize: 15, color: colors.textMuted },
  итогСумма: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // Копейки мельче и бледнее: на них не смотрят, а место они занимают.
  итогКопейки: { fontSize: 19, fontWeight: '400', color: colors.textMuted },

  соседи: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  сосед: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  соседЗначок: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  соседЗначокТекст: { fontSize: 18, color: colors.success },
  соседТекст: { fontSize: 16, color: colors.text, maxWidth: 200 },

  тень: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  лист: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: spacing.md,
    maxHeight: '70%',
  },
  листЗаголовок: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  поиск: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.bg,
    fontSize: 17,
    color: colors.text,
  },
  пункт: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  пунктТекст: { flex: 1, fontSize: 17, color: colors.text },
  пунктВыбран: { color: ОРАНЖЕВЫЙ, fontWeight: '600' },
  галка: { fontSize: 17, color: ОРАНЖЕВЫЙ },
  ещё: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
