import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import {
  быстрыеПериоды,
  днейВМесяце,
  полнаяДата,
  ужатьЧисло,
} from '../domain/reportFilter';
import { colors, spacing } from './theme';

/**
 * Окно «Дата» в отчёте — по снимку Вазгена.
 *
 * Сверху две вкладки: «Начало периода» и «Конец периода», у невыбранной
 * под названием стоит её дата. Под ними колёсико из трёх столбиков —
 * число, месяц, год, — синяя кнопка «Применить», а ниже готовые периоды:
 * Сегодня, Вчера, Неделя, Месяц, Прошлый месяц, Год.
 *
 * Готовые периоды важнее колёсика: за ними лезут в девяти случаях из
 * десяти, а «Прошлый месяц» колёсиком — это шесть движений вместо одного.
 * Поэтому они и стоят списком, а не прячутся за ним.
 */

const МЕСЯЦЫ = [
  'Января', 'Февраля', 'Марта', 'Апреля', 'Мая', 'Июня',
  'Июля', 'Августа', 'Сентября', 'Октября', 'Ноября', 'Декабря',
];

/** Высота строки колёсика. По ней же считается, на какой строке оно встало. */
const СТРОКА = 56;
/** Сколько пустых строк сверху и снизу, чтобы крайние доезжали до середины. */
const ПОЛЯ = 3;

export function ОкноДаты({
  открыто,
  от,
  до,
  закрыть,
  применить,
}: {
  открыто: boolean;
  /** Нынешние границы, «2026-09-01». */
  от: string;
  до: string;
  закрыть: () => void;
  применить: (от: string, до: string) => void;
}) {
  const [край, выбратьКрай] = useState<'от' | 'до'>('от');
  const [начало, задатьНачало] = useState(от);
  const [конец, задатьКонец] = useState(до);

  // Пока окно закрыто, оно живёт со старыми числами; открывая — подхватываем
  // те, что сейчас в отчёте. Иначе после «Применить» и повторного открытия
  // колёсико показывало бы прошлый выбор.
  useEffect(() => {
    if (открыто) {
      задатьНачало(от);
      задатьКонец(до);
      выбратьКрай('от');
    }
  }, [открыто, от, до]);

  const текущий = край === 'от' ? начало : конец;
  const [год, месяц, число] = текущий.split('-').map(Number);

  const задать = (новый: string) => (край === 'от' ? задатьНачало(новый) : задатьКонец(новый));

  const сменить = (г: number, м: number, ч: number) => {
    // 31 марта при переходе на февраль превращается в 28, а не в 3 марта.
    const ужатое = ужатьЧисло(г, м, ч);
    задать(
      `${г}-${String(м).padStart(2, '0')}-${String(ужатое).padStart(2, '0')}`,
    );
  };

  const годы = Array.from({ length: 12 }, (_, шаг) => год - 6 + шаг);
  const числа = Array.from({ length: днейВМесяце(год, месяц) }, (_, шаг) => шаг + 1);

  const готовые = быстрыеПериоды();

  return (
    <Modal visible={открыто} transparent animationType="slide" onRequestClose={закрыть}>
      <Pressable style={стиль.тень} onPress={закрыть}>
        <Pressable style={стиль.лист} onPress={() => {}}>
          <View style={стиль.ручка} />

          <View style={стиль.вкладки}>
            <Вкладка
              имя="Начало периода"
              дата={край === 'от' ? null : полнаяДата(начало)}
              выбрана={край === 'от'}
              onPress={() => выбратьКрай('от')}
            />
            <Вкладка
              имя="Конец периода"
              дата={край === 'до' ? null : полнаяДата(конец)}
              выбрана={край === 'до'}
              onPress={() => выбратьКрай('до')}
            />
          </View>

          <View style={стиль.колёсико}>
            {/* Светлая полоса посередине — она показывает, что выбрано. */}
            <View style={стиль.полоса} pointerEvents="none" />

            <Столбик
              значения={числа.map(String)}
              выбрано={число - 1}
              выбрать={(шаг) => сменить(год, месяц, числа[шаг])}
              ширина={90}
            />
            <Столбик
              значения={МЕСЯЦЫ}
              выбрано={месяц - 1}
              выбрать={(шаг) => сменить(год, шаг + 1, число)}
              ширина={150}
            />
            <Столбик
              значения={годы.map(String)}
              выбрано={годы.indexOf(год)}
              выбрать={(шаг) => сменить(годы[шаг], месяц, число)}
              ширина={110}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            style={стиль.применить}
            onPress={() => {
              // Перевёрнутый период молча разворачиваем: человек выбрал две
              // даты, и какая из них раньше — забота программы, а не его.
              const [раньше, позже] =
                начало <= конец ? [начало, конец] : [конец, начало];
              применить(раньше, позже);
              закрыть();
            }}
          >
            <Text style={стиль.применитьТекст}>Применить</Text>
          </Pressable>

          <View style={стиль.полоска} />

          <ScrollView>
            {готовые.map((один) => (
              <Pressable
                key={один.ключ}
                accessibilityRole="button"
                style={стиль.готовый}
                onPress={() => {
                  применить(один.от, один.до);
                  закрыть();
                }}
              >
                <View style={стиль.готовыйТело}>
                  <Text style={стиль.готовыйИмя}>{один.имя}</Text>
                  <Text style={стиль.готовыйПодпись}>{один.подпись}</Text>
                </View>
                <Text style={стиль.стрелка}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Вкладка({
  имя,
  дата,
  выбрана,
  onPress,
}: {
  имя: string;
  /** Дата под названием — только у невыбранной: у выбранной её крутят выше. */
  дата: string | null;
  выбрана: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: выбрана }}
      style={[стиль.вкладка, выбрана && стиль.вкладкаВыбрана]}
      onPress={onPress}
    >
      <Text style={[стиль.вкладкаИмя, выбрана && стиль.вкладкаИмяВыбрана]}>{имя}</Text>
      {дата ? <Text style={стиль.вкладкаДата}>{дата}</Text> : null}
    </Pressable>
  );
}

/**
 * Один столбик колёсика.
 *
 * Крутится обычной прокруткой с прилипанием к строке. Выбранным считается
 * то, что встало посередине, — поэтому сверху и снизу добавлены пустые
 * строки: без них первое и последнее значение до середины не доезжают.
 */
function Столбик({
  значения,
  выбрано,
  выбрать,
  ширина,
}: {
  значения: string[];
  выбрано: number;
  выбрать: (шаг: number) => void;
  ширина: number;
}) {
  const лента = useRef<ScrollView>(null);
  /*
   * Минус единица, а не `выбрано`.
   *
   * Начни отсюда с выбранного — и первый же проход решит, что колёсико
   * уже стоит где надо, и не подведёт его. Так и вышло: открыв окно на
   * сентябре 2026, я увидел в полосе «1 Января 2020» — колёсико осталось
   * в начале списка, а подпись говорила своё.
   */
  const последний = useRef(-1);

  useEffect(() => {
    // Подвести к выбранному — и при открытии, и когда число ужалось само
    // (31 марта → 28 февраля): иначе полоса стоит на одном, а в подписи
    // другое.
    if (выбрано >= 0 && выбрано !== последний.current) {
      последний.current = выбрано;
      лента.current?.scrollTo({ y: выбрано * СТРОКА, animated: false });
    }
  }, [выбрано]);

  const встал = (событие: NativeSyntheticEvent<NativeScrollEvent>) => {
    const шаг = Math.round(событие.nativeEvent.contentOffset.y / СТРОКА);
    const вГраницах = Math.max(0, Math.min(значения.length - 1, шаг));
    if (вГраницах !== выбрано) {
      последний.current = вГраницах;
      выбрать(вГраницах);
    }
  };

  return (
    <ScrollView
      ref={лента}
      style={{ width: ширина }}
      contentContainerStyle={{ paddingVertical: СТРОКА * ПОЛЯ }}
      showsVerticalScrollIndicator={false}
      snapToInterval={СТРОКА}
      decelerationRate="fast"
      onMomentumScrollEnd={встал}
      onScrollEndDrag={встал}
      scrollEventThrottle={16}
    >
      {значения.map((значение, шаг) => (
        <Pressable
          key={значение}
          accessibilityRole="button"
          style={стиль.ячейка}
          onPress={() => {
            лента.current?.scrollTo({ y: шаг * СТРОКА, animated: true });
            выбрать(шаг);
          }}
        >
          {/* Чем дальше от полосы, тем бледнее — так у него колёсико не
              обрывается краем, а растворяется. Считаем от выбранного, а не
              от положения прокрутки: гоняться за каждым кадром ради
              оттенка не стоит того. */}
          <Text
            style={[
              стиль.ячейкаТекст,
              { opacity: затухание(Math.abs(шаг - выбрано)) },
              шаг === выбрано && стиль.ячейкаВыбрана,
            ]}
            numberOfLines={1}
          >
            {значение}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Насколько бледна строка, отстоящая от выбранной на столько-то шагов. */
function затухание(шагов: number): number {
  return [1, 0.55, 0.3, 0.16][шагов] ?? 0.1;
}

const стиль = StyleSheet.create({
  тень: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  лист: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
  },
  ручка: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 10,
    marginBottom: 6,
  },

  вкладки: { flexDirection: 'row' },
  вкладка: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  вкладкаВыбрана: { borderBottomColor: colors.textMuted },
  вкладкаИмя: { fontSize: 20, color: colors.textMuted },
  вкладкаИмяВыбрана: { color: colors.text, fontWeight: '600' },
  вкладкаДата: { fontSize: 15, color: colors.textMuted, marginTop: 2 },

  колёсико: {
    flexDirection: 'row',
    justifyContent: 'center',
    height: СТРОКА * (ПОЛЯ * 2 + 1),
    paddingVertical: 0,
  },
  полоса: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: СТРОКА * ПОЛЯ,
    height: СТРОКА,
    borderRadius: 10,
    backgroundColor: colors.bg,
  },
  ячейка: { height: СТРОКА, alignItems: 'center', justifyContent: 'center' },
  ячейкаТекст: { fontSize: 26, color: colors.textMuted },
  ячейкаВыбрана: { color: colors.text },

  применить: {
    backgroundColor: colors.primary,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
  },
  применитьТекст: { fontSize: 19, fontWeight: '700', color: colors.primaryText },

  полоска: { height: 10, backgroundColor: colors.bg },

  готовый: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  готовыйТело: { flex: 1 },
  готовыйИмя: { fontSize: 19, color: colors.text },
  готовыйПодпись: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
  стрелка: { fontSize: 26, color: colors.textMuted },
});
