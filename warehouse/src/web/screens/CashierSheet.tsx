import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { useCashierKeys } from './useCashierKeys';
import { pos } from '../../ui/webTheme';

/**
 * Нижний лист кассы — то, чем она спрашивает «точно?».
 *
 * Это её единственный способ переспросить: в кассирском приложении любое
 * подтверждение — один и тот же список, всплывающий снизу. Сверху вопрос по
 * центру, под ним строка действия со значком слева и клавишей справа, черта,
 * и последней строкой «Отмена» с Esc. Опасное действие красное — и текст, и
 * значок.
 *
 * Так устроено закрытие смены: «Вы действительно хотите закрыть смену?» —
 * «Закрыть смену» / Enter — «Отмена» / Esc.
 *
 * Лист всплывает снизу, а не по центру: касса — сенсорный экран, и всё, что
 * нажимают, держится ближе к рукам.
 */

export interface SheetItem {
  label: string;
  onPress: () => void;
  /** Красит строку и рисует значок слева. */
  severity?: 'error' | 'warning' | 'success';
  /** Клавиша, которая нажимает строку. Показывается справа. */
  shortKey?: string;
}

const SEVERITY_COLOR = {
  error: '#D32F2F',
  warning: '#ED6C02',
  success: '#2E7D32',
} as const;

const SEVERITY_GLYPH = {
  error: '!',
  warning: '!',
  success: '✓',
} as const;

export function CashierSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  /** Вопрос — подзаголовок по центру. */
  title: string;
  items: SheetItem[];
  onClose: () => void;
}) {
  // Клавиши те же, что подписаны справа от строк: Enter нажимает действие,
  // Esc отменяет. Кассир работает не мышью.
  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    const item = items.find((entry) => entry.shortKey === event.key);
    if (item) {
      event.preventDefault();
      onClose();
      item.onPress();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть окно"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.sheet}>
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>

            {items.map((item) => (
              <Row
                key={item.label}
                item={item}
                onPick={() => {
                  onClose();
                  item.onPress();
                }}
              />
            ))}

            <View style={styles.divider} />

            <Row item={{ label: 'Отмена', onPress: onClose, shortKey: 'Esc' }} onPick={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Row({ item, onPick }: { item: SheetItem; onPick: () => void }) {
  const color = item.severity ? SEVERITY_COLOR[item.severity] : pos.text;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPick}
      style={(state) => [styles.row, (state as { hovered?: boolean }).hovered && styles.rowHover]}
    >
      <View style={styles.rowIcon}>
        {item.severity ? (
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeGlyph, { color }]}>{SEVERITY_GLYPH[item.severity]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.rowLabel, { color }]}>{item.label}</Text>
      {item.shortKey ? (
        <View style={styles.key}>
          <Text style={styles.keyLabel}>{item.shortKey}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Затемнение у него почти незаметное: лист не уводит внимание с кассы, а
  // задаёт один вопрос поверх неё.
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: { width: '40%', minWidth: 600, maxWidth: '100%', padding: 16, zIndex: 1 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    paddingVertical: 8,
    // Лист приподнят над кассой — у него это elevation 4.
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
  },
  title: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 48 },
  rowHover: { backgroundColor: pos.bg },
  rowIcon: { width: 26, alignItems: 'center' },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeGlyph: { fontFamily: pos.font, fontSize: 13, lineHeight: 16 },
  rowLabel: { flex: 1, fontFamily: pos.font, fontSize: 15 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: pos.muted },
  divider: { height: 1, backgroundColor: pos.border, marginVertical: 6 },
});
