import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PRESETS, PRESET_LABEL, type CatalogFilters } from '../state/catalogFilters';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Панель фильтров каталога в кабинете.
 *
 * Открывается тем же способом, что выпадающие списки: подложка на весь экран
 * плюс панель поверх неё. Подложка стоит отдельным элементом *до* панели, а не
 * оборачивает её: вложенная кнопка в вебе перехватывает нажатия у своих
 * потомков, и панель тогда молчит на каждый щелчок.
 */
export function FilterPanel({
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть фильтр" />

      <View style={styles.panel}>
        <View style={styles.head}>
          <Text style={styles.title}>Фильтр</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>×</Text>
          </Pressable>
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
                style={(state) => [
                  styles.row,
                  (state as { hovered?: boolean }).hovered && styles.rowHover,
                ]}
              >
                <View style={[styles.box, picked && styles.boxChecked]}>
                  {picked ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.label}>{PRESET_LABEL[preset]}</Text>
                <Text style={styles.count}>{filters.counts[preset] ?? 0}</Text>
              </Pressable>
            );
          })}

          {filters.saved.length > 0 ? (
            <>
              <Text style={styles.section}>Свои фильтры</Text>
              {filters.saved.map((item) => (
                <View key={item.name} style={styles.row}>
                  <Text style={styles.link} onPress={() => filters.apply(item)}>
                    {item.name}
                  </Text>
                  <Text style={styles.remove} onPress={() => filters.remove(item.name)}>
                    удалить
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>

        <View style={styles.foot}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Назвать и сохранить"
            placeholderTextColor={web.textMuted}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!name.trim() || filters.active === 0}
            onPress={() => {
              filters.save(name);
              setName('');
            }}
            style={styles.save}
          >
            <Text style={styles.saveLabel}>Сохранить</Text>
          </Pressable>
        </View>

        <View style={styles.foot}>
          <Pressable accessibilityRole="button" onPress={filters.clear} style={styles.reset}>
            <Text style={styles.resetLabel}>Сбросить</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.apply}>
            <Text style={styles.applyLabel}>Показать</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  panel: {
    position: 'absolute',
    top: 108,
    left: 240,
    width: 420,
    maxHeight: 560,
    zIndex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  title: { fontFamily: WEB_FONT, fontSize: 16, color: web.text },
  close: { fontFamily: WEB_FONT, fontSize: 22, color: web.textMuted, lineHeight: 22 },
  list: { paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  rowHover: { backgroundColor: web.rowHover },
  box: {
    width: 15,
    height: 15,
    borderWidth: 1,
    borderColor: '#B7BBBF',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: web.link, borderColor: web.link },
  tick: { fontFamily: WEB_FONT, fontSize: 11, color: '#FFFFFF', lineHeight: 13 },
  label: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  count: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  section: {
    fontFamily: WEB_FONT, fontSize: 12,
    color: web.textMuted,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  link: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  remove: { fontFamily: WEB_FONT, fontSize: 13, color: web.danger },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  input: {
    flex: 1,
    height: 32,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 2,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT, fontSize: 14,
    color: web.text,
  },
  save: { paddingHorizontal: 12, paddingVertical: 7 },
  saveLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  reset: { paddingHorizontal: 12, paddingVertical: 7 },
  resetLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  apply: {
    marginLeft: 'auto',
    paddingHorizontal: 18,
    paddingVertical: 7,
    backgroundColor: web.green,
    borderRadius: 2,
  },
  applyLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },
});
