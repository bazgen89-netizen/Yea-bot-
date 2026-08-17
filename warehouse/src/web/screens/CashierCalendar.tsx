import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  isoDay,
  monthGrid,
  MONTHS,
  MONTHS_SHORT,
  shiftMonth,
  WEEKDAYS,
} from '../../domain/calendar';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Календарь под кнопкой «Выберите дату» в журнале чеков.
 *
 * Список дней, в которые были чеки, был честнее — в нём не выбрать пустое
 * число, — но неудобнее: покупку помнят как «в прошлый вторник», а не
 * «двенадцатым в списке». Календарь отвечает на этот вопрос сразу, поэтому
 * он и стоит в кассе у них.
 *
 * Заголовок «август 2026» открывает выбор месяца, стрелки листают по одному,
 * сегодняшнее число обведено, выбранное залито, «ОЧИСТИТЬ» снимает условие.
 */
export function CashierCalendar({
  value,
  onPick,
  onClear,
}: {
  /** Выбранный день, `YYYY-MM-DD`; null — условие не задано. */
  value: string | null;
  onPick: (day: string) => void;
  onClear: () => void;
}) {
  const today = new Date();
  // Открываемся на месяце выбранного дня, а не на текущем: вернувшись к
  // фильтру, кассир должен увидеть то, что выбрал.
  const start = value ? new Date(`${value}T00:00:00`) : today;

  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth());
  const [pickingMonth, setPickingMonth] = useState(false);

  const weeks = monthGrid(year, month);
  const todayIso = isoDay(today.getFullYear(), today.getMonth(), today.getDate());

  const step = (delta: number) => {
    const next = pickingMonth
      ? { year: year + delta, month }
      : shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Выбрать месяц"
          onPress={() => setPickingMonth((open) => !open)}
          style={styles.title}
        >
          <Text style={styles.titleLabel}>
            {pickingMonth ? year : `${MONTHS[month]} ${year}`}
          </Text>
          {pickingMonth ? (
            <WebIcon.caretUp color={pos.text} size={16} />
          ) : (
            <WebIcon.caretDown color={pos.text} size={16} />
          )}
        </Pressable>

        <View style={styles.arrows}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pickingMonth ? 'Прошлый год' : 'Прошлый месяц'}
            onPress={() => step(-1)}
            style={styles.arrow}
          >
            <WebIcon.chevronLeft color={pos.muted} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pickingMonth ? 'Следующий год' : 'Следующий месяц'}
            onPress={() => step(1)}
            style={styles.arrow}
          >
            <WebIcon.chevronRight color={pos.muted} size={22} />
          </Pressable>
        </View>
      </View>

      {pickingMonth ? (
        <View style={styles.months}>
          {MONTHS_SHORT.map((name, index) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={MONTHS[index]}
              onPress={() => {
                setMonth(index);
                setPickingMonth(false);
              }}
              style={[styles.month, index === month && styles.monthActive]}
            >
              <Text style={[styles.monthLabel, index === month && styles.monthLabelActive]}>
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View style={styles.week}>
            {WEEKDAYS.map((name, index) => (
              <Text key={index} style={styles.weekday}>
                {name}
              </Text>
            ))}
          </View>

          {weeks.map((week, index) => (
            <View key={index} style={styles.week}>
              {week.map((day, at) => {
                if (day === null) return <View key={at} style={styles.day} />;

                const iso = isoDay(year, month, day);
                return (
                  <Pressable
                    key={at}
                    accessibilityRole="button"
                    accessibilityLabel={`${day} ${MONTHS[month]} ${year}`}
                    accessibilityState={{ selected: iso === value }}
                    onPress={() => onPick(iso)}
                    style={styles.day}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        // Сегодня — обведено, выбранное — залито. Два разных
                        // знака, потому что это два разных вопроса: «какое
                        // сегодня» и «что я выбрал».
                        iso === todayIso && styles.dayToday,
                        iso === value && styles.daySelected,
                      ]}
                    >
                      <Text style={[styles.dayLabel, iso === value && styles.dayLabelSelected]}>
                        {day}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onClear}
        style={styles.clear}
      >
        <Text style={styles.clearLabel}>ОЧИСТИТЬ</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    marginTop: 4,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    // Тень в вебе рисуется, а край панели — нет: без рамки календарь
    // сливается с белым окном журнала.
    borderWidth: 1,
    borderColor: pos.border,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  titleLabel: { fontFamily: pos.font, fontSize: 18, fontWeight: '500', color: pos.text },
  arrows: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  week: { flexDirection: 'row', justifyContent: 'space-between' },
  // Клетки тянутся по ширине столбца фильтра, а не заданы числом: иначе
  // календарь вылезал за край и накрывался соседней колонкой — нажатия
  // по правым числам уходили не ему.
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    marginBottom: 6,
  },

  day: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayToday: { borderColor: pos.muted },
  daySelected: { backgroundColor: pos.bar, borderColor: pos.bar },
  dayLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  dayLabelSelected: { color: '#FFFFFF' },

  months: { flexDirection: 'row', flexWrap: 'wrap' },
  month: {
    width: '25%',
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthActive: {},
  monthLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  monthLabelActive: { color: pos.bar, fontWeight: '700' },

  clear: { alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 8, marginTop: 4 },
  clearLabel: { fontFamily: pos.font, fontSize: 14, color: pos.accent, letterSpacing: 0.6 },
});
