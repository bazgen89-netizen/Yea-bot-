import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  PRESETS,
  PRESET_LABEL,
  type CatalogFilters,
} from '../state/catalogFilters';
import { Icon } from './icons';
import { colors, radius, spacing, text } from './theme';

/**
 * Фильтры каталога на телефоне.
 *
 * Раньше на кнопке-воронке висел один переключатель «только заканчивающиеся».
 * Здесь — те же восемь готовых фильтров, что в исходном приложении, с числом
 * позиций у каждого: без числа непонятно, стоит ли вообще нажимать.
 */
export function FilterSheet({
  visible,
  onClose,
  filters,
}: {
  visible: boolean;
  onClose: () => void;
  filters: CatalogFilters;
}) {
  const [name, setName] = useState('');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть фильтры" />

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <View style={styles.head}>
          <Text style={text.heading}>Фильтр</Text>
          {filters.active > 0 ? (
            <Pressable accessibilityRole="button" onPress={filters.clear} hitSlop={8}>
              <Text style={styles.reset}>Сбросить</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView style={styles.list}>
          {PRESETS.map((preset) => {
            const picked = filters.presets.includes(preset);
            return (
              <Pressable
                key={preset}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: picked }}
                onPress={() => filters.toggle(preset)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.label, picked && styles.labelPicked]}>
                  {PRESET_LABEL[preset]}
                </Text>
                <Text style={styles.count}>{filters.counts[preset] ?? 0}</Text>
                {picked ? <Icon.check color={colors.accent} /> : null}
              </Pressable>
            );
          })}

          {filters.saved.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Свои фильтры</Text>
              {filters.saved.map((item) => (
                <View key={item.name} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => filters.apply(item)}
                    style={styles.savedName}
                  >
                    <Text style={styles.label}>{item.name}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Удалить фильтр ${item.name}`}
                    onPress={() => filters.remove(item.name)}
                    hitSlop={8}
                  >
                    <Text style={styles.remove}>Удалить</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}

          {filters.active > 0 ? (
            <View style={styles.saveRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Назвать и сохранить"
                placeholderTextColor={colors.textMuted}
                style={styles.saveInput}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!name.trim()}
                onPress={() => {
                  filters.save(name);
                  setName('');
                }}
                style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.saveLabel}>Сохранить</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.done, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.doneLabel}>Показать</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginVertical: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reset: { fontSize: 15, color: colors.accent },
  list: { marginTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { flex: 1, fontSize: 16, color: colors.text },
  labelPicked: { color: colors.accent, fontWeight: '600' },
  count: { fontSize: 15, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  sectionTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  savedName: { flex: 1 },
  remove: { fontSize: 14, color: colors.danger },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  saveInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  saveButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  saveLabel: { fontSize: 15, color: colors.accent },
  done: {
    marginTop: spacing.md,
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneLabel: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
