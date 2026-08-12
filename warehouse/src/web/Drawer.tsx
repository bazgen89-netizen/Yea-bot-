import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WebIcon } from '../ui/icons';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Панель справа поверх страницы — `.cs_container` оригинала.
 *
 * В его кабинете почти всё, что открывается из таблицы, открывается так:
 * товар, его правка, история движения, групповые операции, оценка склада.
 * В таблице состояний у этих экранов стоит `sidebar: true`, и это не украшение
 * — список остаётся виден слева, и после закрытия не нужно заново искать, где
 * ты был. Товары так открывают один за другим.
 *
 * Размеры — его же, из таблицы стилей: `xs` 600, `s` 700, `m` 800 (столько по
 * умолчанию), `l` 900, `xl` 1000. Тень слева, затемнение позади, закрытие по
 * нажатию мимо панели.
 *
 * Сверху панели — полоса действий (`.ui.menu.actions`): слева кнопка возврата,
 * дальше кнопки самого экрана. Полоса не прокручивается вместе с содержимым:
 * «Сохранить» должно быть под рукой и внизу длинной формы.
 */

export type DrawerSize = 'xs' | 's' | 'm' | 'l' | 'xl';

const WIDTH: Record<DrawerSize, number> = {
  xs: 600,
  s: 700,
  m: 800,
  l: 900,
  xl: 1000,
};

export function Drawer({
  visible,
  size = 'm',
  onClose,
  /** Кнопки в полосе действий — справа от кнопки возврата. */
  actions,
  /**
   * Панель открыта поверх другой такой же (правка поверх просмотра): тогда
   * слева стрелка «назад», а не крестик — так же, как у него.
   */
  nested,
  children,
}: {
  visible: boolean;
  size?: DrawerSize;
  onClose: () => void;
  actions?: ReactNode;
  nested?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Затемнение — отдельный слой под панелью, а не обёртка вокруг неё:
          вложенная кнопка в вебе перехватывает нажатия у того, что внутри. */}
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={[styles.panel, { width: WIDTH[size] }]}>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nested ? 'Назад' : 'Закрыть'}
              onPress={onClose}
              style={styles.back}
            >
              {nested ? (
                <WebIcon.chevronLeft size={18} color={web.text} />
              ) : (
                <WebIcon.close size={18} color={web.text} />
              )}
            </Pressable>

            {actions}
          </View>

          <ScrollView style={styles.content}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Кнопка полосы действий: зелёная «Сохранить», обычная «Отмена», красная «Удалить». */
export function DrawerButton({
  label,
  tone = 'plain',
  onPress,
  right,
}: {
  label: string;
  tone?: 'plain' | 'green' | 'orangeOutline' | 'dangerOutline';
  onPress?: () => void;
  /** Прижать к правому краю полосы — там у него стоит «Удалить». */
  right?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, TONE[tone], right && styles.rightButton]}
    >
      <Text style={[styles.buttonLabel, TONE_TEXT[tone]]}>{label}</Text>
    </Pressable>
  );
}

const TONE = StyleSheet.create({
  plain: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(34,36,38,0.15)' },
  green: { backgroundColor: web.green },
  orangeOutline: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: web.orange },
  dangerOutline: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: web.danger },
});

const TONE_TEXT = StyleSheet.create({
  plain: { color: web.text },
  green: { color: '#FFFFFF' },
  orangeOutline: { color: web.orange },
  dangerOutline: { color: web.danger },
});

const styles = StyleSheet.create({
  // Затемнение у него почти незаметное — `rgba(100,100,100,.07)`. И это не
  // недосмотр: панель не перекрывает работу, а дополняет её, и таблица слева
  // должна оставаться читаемой — по ней тут же выбирают следующий товар.
  root: { flex: 1, backgroundColor: 'rgba(100,100,100,0.07)', alignItems: 'flex-end' },
  panel: {
    height: '100%',
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
    // `box-shadow: -10px 0 15px -5px rgba(0,0,0,.1)` — тень падает влево, на
    // таблицу, из которой панель выехала.
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: -10, height: 0 },
    // Затемнение позиционировано абсолютно и потому рисуется поверх обычного
    // потока — без этого оно накрывало бы саму панель и съедало её нажатия.
    zIndex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
    backgroundColor: '#FFFFFF',
  },
  back: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: { borderRadius: 4, paddingHorizontal: 18, paddingVertical: 9 },
  rightButton: { marginLeft: 'auto' },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 14 },
  content: { flex: 1 },
});
