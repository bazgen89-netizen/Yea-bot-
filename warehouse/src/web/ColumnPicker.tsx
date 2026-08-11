import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CATALOG_COLUMNS, DEFAULT_COLUMNS } from './catalogColumns';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Выбор колонок справочника.
 *
 * Колонок двадцать четыре, и одновременно они не помещаются — значит выбор
 * обязателен, иначе часть данных просто недоступна. «Наименование» снять
 * нельзя: строка без названия не опознаётся.
 */
export function ColumnPicker({
  visible,
  onClose,
  shown,
  onToggle,
  onReset,
}: {
  visible: boolean;
  onClose: () => void;
  shown: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть колонки" />

      <View style={styles.panel}>
        <View style={styles.head}>
          <Text style={styles.title}>Колонки</Text>
          <Text style={styles.count}>
            {shown.length} из {CATALOG_COLUMNS.length}
          </Text>
        </View>

        <ScrollView style={styles.list}>
          {CATALOG_COLUMNS.map((column) => {
            const on = shown.includes(column.key);
            const locked = column.key === 'name';

            return (
              <Pressable
                key={column.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: locked }}
                disabled={locked}
                onPress={() => onToggle(column.key)}
                style={(state) => [
                  styles.row,
                  (state as { hovered?: boolean }).hovered && styles.rowHover,
                  locked && styles.rowLocked,
                ]}
              >
                <View style={[styles.box, on && styles.boxOn]}>
                  {on ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.label}>{column.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.foot}>
          <Pressable accessibilityRole="button" onPress={onReset} style={styles.reset}>
            <Text style={styles.resetLabel}>По умолчанию</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.apply}>
            <Text style={styles.applyLabel}>Готово</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export { DEFAULT_COLUMNS };

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
    right: 30,
    width: 320,
    maxHeight: 620,
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
  count: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  list: { paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  rowHover: { backgroundColor: web.rowHover },
  rowLocked: { opacity: 0.5 },
  box: {
    width: 15,
    height: 15,
    borderWidth: 1,
    borderColor: '#B7BBBF',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: web.link, borderColor: web.link },
  tick: { fontFamily: WEB_FONT, fontSize: 11, color: '#FFFFFF', lineHeight: 13 },
  label: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
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
