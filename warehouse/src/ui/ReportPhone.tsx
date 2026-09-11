import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listLocations } from '../db/locations';
import { periodFor, type PeriodKind } from '../db/reports';
import type { ReportDefinition } from '../db/reportTypes';
import { listStaff } from '../db/staff';
import {
  естьОтбор,
  подписьПериода,
  поРусски,
  рублиИкопейки,
  ПУСТОЙ_ОТБОР,
  type ОтборОтчёта,
} from '../domain/reportFilter';
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
  период: PeriodKind;
  отбор: ОтборОтчёта;
}

const ПЕРИОДЫ: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
];

export function ReportPhone({
  report,
  соседний,
}: {
  report: ReportDefinition;
  /** Отчёт, кнопка на который стоит внизу: у него под «днями» — «недели». */
  соседний?: { id: string; title: string } | null;
}) {
  const router = useRouter();

  const [выбор, задать] = useState<Выбор>(() => ({
    // Первая числовая колонка — «Сумма продаж», она же его «Выручка».
    колонка: Math.max(1, report.columns.findIndex((c) => c.numeric)),
    период: 'month',
    отбор: ПУСТОЙ_ОТБОР,
  }));

  /** Какое окошко выбора открыто. */
  const [окно, открыть] = useState<null | 'период' | 'параметр' | 'сотрудник' | 'магазин'>(null);
  const [сколько, показать] = useState(ПОРЦИЯ);

  const период = useMemo(() => periodFor(выбор.период), [выбор.период]);

  const строки = useQuery(
    (db) => report.rows(db, период, выбор.отбор),
    [report.id, период.from, период.to, выбор.отбор.место, выбор.отбор.сотрудник],
  );
  const итог = useQuery(
    (db) => (report.total ? report.total(db, период, выбор.отбор) : null),
    [report.id, период.from, период.to, выбор.отбор.место, выбор.отбор.сотрудник],
  );

  const магазины = useQuery((db) => listLocations(db), []);
  const сотрудники = useQuery((db) => listStaff(db), []);

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

  const видно = строки.slice(0, сколько);
  const [рубли, копейки] = рублиИкопейки(поРусски(String(итог?.[выбор.колонка] ?? '')));

  return (
    <View style={стиль.экран}>
      {/* Лента фишек. Она листается вбок: у него «Магазин» и «Очистить»
          видны только после прокрутки, и это нормально — важнейшие слева. */}
      <View style={стиль.лента}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={стиль.лентаТело}>
          <Фишка
            подпись="Дата"
            значение={подписьПериода(период.from, период.to)}
            onPress={() => открыть('период')}
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

      {/* Шапка таблицы. Слева название строки, справа выбранный параметр. */}
      <View style={стиль.шапка}>
        <Text style={стиль.шапкаЛево}>{report.columns[0]?.title ?? 'Наименование'}</Text>
        <Text style={стиль.шапкаПраво}>{report.columns[выбор.колонка]?.title ?? ''}</Text>
      </View>

      <ScrollView
        onScroll={({ nativeEvent: н }) => {
          const дно = н.contentOffset.y + н.layoutMeasurement.height >= н.contentSize.height - 400;
          if (дно && сколько < строки.length) показать((было) => было + ПОРЦИЯ);
        }}
        scrollEventThrottle={200}
      >
        {видно.map((строка, номер) => (
          <View key={номер} style={стиль.строка}>
            <Text style={стиль.название} numberOfLines={2}>
              {строка[0]}
            </Text>
            <Text style={стиль.значение} numberOfLines={1}>
              {поРусски(строка[выбор.колонка] ?? '')}
            </Text>
          </View>
        ))}

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

      {соседний ? (
        <Pressable
          accessibilityRole="button"
          style={стиль.сосед}
          onPress={() =>
            router.replace({ pathname: '/reports/[type]', params: { type: соседний.id } })
          }
        >
          <View style={стиль.соседЗначок}>
            <Text style={стиль.соседЗначокТекст}>▤</Text>
          </View>
          <Text style={стиль.соседТекст}>{соседний.title}</Text>
        </Pressable>
      ) : null}

      <Окно
        открыто={окно === 'период'}
        заголовок="Дата"
        строки={ПЕРИОДЫ.map((один) => ({ ключ: один.value, имя: один.label }))}
        выбрано={выбор.период}
        закрыть={() => открыть(null)}
        выбрать={(ключ) => задать((было) => ({ ...было, период: ключ as PeriodKind }))}
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

/** Окошко выбора — список снизу, как у него. */
function Окно({
  открыто,
  заголовок,
  строки,
  выбрано,
  закрыть,
  выбрать,
}: {
  открыто: boolean;
  заголовок: string;
  строки: { ключ: string; имя: string }[];
  выбрано: string;
  закрыть: () => void;
  выбрать: (ключ: string) => void;
}) {
  return (
    <Modal visible={открыто} transparent animationType="slide" onRequestClose={закрыть}>
      <Pressable style={стиль.тень} onPress={закрыть}>
        {/* Нажатие по самому листу не должно его закрывать. */}
        <Pressable style={стиль.лист} onPress={() => {}}>
          <Text style={стиль.листЗаголовок}>{заголовок}</Text>
          <ScrollView>
            {строки.map((один) => (
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
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  шапкаЛево: { flex: 1, fontSize: 15, color: colors.textMuted },
  шапкаПраво: { fontSize: 15, color: colors.textMuted },

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

  сосед: {
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
});
