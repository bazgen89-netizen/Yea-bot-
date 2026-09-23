import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../Translated';
import { useCashierKeys } from './useCashierKeys';
import { getSettings } from '../../db/settings';
import { currentStaff } from '../../db/staff';
import { ROLE_LABEL } from '../../domain/permissions';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Меню трёх точек на кнопке продажи.
 *
 * Открывается только когда в чеке что-то есть: пустой чек нельзя ни отложить,
 * ни отменить, и меню из двух недоступных строк было бы обманом.
 *
 * Сверху — кто за кассой: имя слева, роль справа. Это не украшение: в смене
 * работают по очереди, и отложенный чек потом ищут по тому, кто его отложил.
 * Ниже — «Отложить чек», красное «Отменить чек» и, отдельной строкой,
 * «Отмена» с Esc.
 */
export function CashierSellMenu({
  visible,
  onClose,
  onHold,
  onCancel,
  who,
  rightInset,
}: {
  visible: boolean;
  onClose: () => void;
  /** Отложить чек — он уйдёт в очередь. */
  onHold: () => void;
  /** Отменить чек — набранное пропадёт. */
  onCancel: () => void;
  /** Чем подписана касса, когда сотрудник не выбран. */
  who: string;
  /**
   * Сколько точек оставить справа — ширина колонки чека.
   *
   * Меню у него всплывает над самими точками и уходит влево, к витрине, а не
   * висит по центру экрана: нажали внизу справа — открылось там же.
   */
  rightInset: number;
}) {
  const staff = useQuery((database) => currentStaff(database));
  const company = useQuery((database) => getSettings(database).name);

  const name = staff?.name ?? company ?? who;
  const role = staff ? ROLE_LABEL[staff.role] : 'Продавец';

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть меню чека"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={[styles.card, { marginRight: rightInset }]}>
          <View style={styles.head}>
            <View style={styles.avatar}>
              <WebIcon.parties size={16} color={pos.muted} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.role}>{role}</Text>
          </View>

          <Row
            label="Отложить чек"
            icon={<WebIcon.history size={22} color={pos.muted} />}
            onPress={() => {
              onClose();
              onHold();
            }}
          />

          <Row
            label="Отменить чек"
            danger
            icon={
              <View style={styles.badge}>
                <Text style={styles.badgeGlyph}>!</Text>
              </View>
            }
            onPress={() => {
              onClose();
              onCancel();
            }}
          />

          <View style={styles.divider} />

          <Row label="Отмена" shortKey="Esc" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Row({
  label,
  icon,
  danger,
  shortKey,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  shortKey?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={(state) => [styles.row, (state as { hovered?: boolean }).hovered && styles.rowHover]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
      {shortKey ? (
        <View style={styles.key}>
          <Text style={styles.keyLabel}>{shortKey}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Меню всплывает над кнопкой продажи — там же, где палец.
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 76,
  },
  card: {
    width: '40%',
    minWidth: 560,
    maxWidth: '100%',
    backgroundColor: pos.tile,
    borderRadius: 4,
    paddingVertical: 8,
    shadowColor: pos.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: pos.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1, fontFamily: pos.font, fontSize: 15, color: pos.text },
  role: { fontFamily: pos.font, fontSize: 14, color: pos.muted },

  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 48 },
  rowHover: { backgroundColor: pos.bg },
  rowIcon: { width: 26, alignItems: 'center' },
  rowLabel: { flex: 1, fontFamily: pos.font, fontSize: 15, color: pos.text },
  rowDanger: { color: pos.red },

  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: pos.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeGlyph: { fontFamily: pos.font, fontSize: 13, lineHeight: 16, color: pos.red },

  divider: { height: 1, backgroundColor: pos.border, marginVertical: 6 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: pos.muted },
});
