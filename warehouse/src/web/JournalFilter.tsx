import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { FORM_BORDER, web, WEB_FONT } from '../ui/webTheme';

/**
 * Панель отбора над журналами — его `inline-filter`.
 *
 * Поля описываются данными, а не разметкой: у движения товара их восемь, у
 * движения денег семь, и половина совпадает. Две почти одинаковые панели
 * разошлись бы при первой же правке.
 *
 * Три вида поля хватает на оба журнала: строка, диапазон дат и выбор из
 * списка. Выбор бывает одиночным (счёт, автор) и множественным (тип
 * документа) — у него так же: тип отмечается галками, остальное выбирается.
 */

export type FilterValue = string | string[] | undefined;

export interface FilterField {
  key: string;
  label: string;
  kind: 'text' | 'dates' | 'select' | 'checks';
  /** Для `select` и `checks` — что предлагать. */
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export function JournalFilter({
  visible,
  onClose,
  fields,
  values,
  onChange,
  onReset,
}: {
  visible: boolean;
  onClose: () => void;
  fields: FilterField[];
  values: Record<string, FilterValue>;
  onChange: (key: string, value: FilterValue) => void;
  onReset: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть фильтр"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Фильтр</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>

                {field.kind === 'text' ? (
                  <TextInput
                    value={(values[field.key] as string) ?? ''}
                    onChangeText={(text) => onChange(field.key, text || undefined)}
                    placeholder={field.placeholder}
                    placeholderTextColor={web.textMuted}
                    style={styles.input}
                  />
                ) : null}

                {field.kind === 'dates' ? (
                  <View style={styles.dates}>
                    <TextInput
                      value={(values[`${field.key}From`] as string) ?? ''}
                      onChangeText={(text) => onChange(`${field.key}From`, text || undefined)}
                      placeholder="с 2026-01-01"
                      placeholderTextColor={web.textMuted}
                      style={[styles.input, styles.dateInput]}
                    />
                    <TextInput
                      value={(values[`${field.key}To`] as string) ?? ''}
                      onChangeText={(text) => onChange(`${field.key}To`, text || undefined)}
                      placeholder="по 2026-12-31"
                      placeholderTextColor={web.textMuted}
                      style={[styles.input, styles.dateInput]}
                    />
                  </View>
                ) : null}

                {field.kind === 'select' ? (
                  <View style={styles.chips}>
                    {[{ value: '', label: 'Все' }, ...(field.options ?? [])].map((option) => {
                      const on = (values[field.key] ?? '') === option.value;
                      return (
                        <Pressable
                          key={option.value || 'all'}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => onChange(field.key, option.value || undefined)}
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {field.kind === 'checks' ? (
                  <View style={styles.chips}>
                    {(field.options ?? []).map((option) => {
                      const picked = (values[field.key] as string[] | undefined) ?? [];
                      const on = picked.includes(option.value);
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          onPress={() =>
                            onChange(
                              field.key,
                              on
                                ? picked.filter((item) => item !== option.value)
                                : [...picked, option.value],
                            )
                          }
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          <View style={styles.foot}>
            <Pressable accessibilityRole="button" onPress={onReset} style={styles.reset}>
              <Text style={styles.resetText}>Сбросить</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.apply}>
              <Text style={styles.applyText}>Показать</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Сколько полей заполнено — это число он показывает на кнопке «Фильтр». */
export function activeCount(values: Record<string, FilterValue>): number {
  return Object.values(values).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(100,100,100,0.07)', alignItems: 'flex-end' },
  panel: {
    width: 460,
    height: '100%',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: -10, height: 0 },
    zIndex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  title: { flex: 1, fontFamily: WEB_FONT, fontSize: 20, color: web.text },
  close: { fontFamily: WEB_FONT, fontSize: 26, color: web.textMuted, lineHeight: 26 },
  body: { padding: 22, gap: 18 },
  field: { gap: 6 },
  label: { fontFamily: WEB_FONT, fontSize: 13, fontWeight: '700', color: 'rgba(0,0,0,0.87)' },
  input: {
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 12,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  dates: { flexDirection: 'row', gap: 10 },
  dateInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    maxWidth: 400,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  chipOn: { backgroundColor: web.link, borderColor: web.link },
  chipText: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  chipTextOn: { color: '#FFFFFF' },
  foot: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  reset: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  resetText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  apply: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 4,
    backgroundColor: web.green,
  },
  applyText: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },
});
