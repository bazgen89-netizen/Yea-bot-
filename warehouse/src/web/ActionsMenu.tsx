import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Translated';
import { WebIcon } from '../ui/icons';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Меню «Действия N поз.» над справочником товаров.
 *
 * Состав и порядок — с его экрана, вплоть до разделителей: сперва «Создать
 * документ» со стрелкой вправо, потом раздел «РАБОТА С ГРУППОЙ ТОВАРОВ» из
 * трёх пунктов, потом ценники и редактор цен, потом три пункта со значками,
 * и внизу, отдельной полосой, красное «Удалить».
 *
 * Пункты, которых у нас ещё нет, показаны приглушёнными, а не выброшены:
 * меню — это ещё и список того, что программа умеет; выбросив половину, мы
 * поменяли бы не только вид, но и обещание.
 */

export interface ActionItem {
  label: string;
  /** Значок слева — у трёх нижних пунктов он есть, у остальных нет. */
  icon?: ReactNode;
  /** Стрелка вправо: пункт раскрывается в свой список. */
  submenu?: ActionItem[];
  onPress?: () => void;
  /** Красный, как «Удалить». */
  danger?: boolean;
  /** Ещё не сделано: виден, но не нажимается. */
  soon?: boolean;
}

/** Заголовок раздела внутри меню — мелкими заглавными. */
export interface ActionGroup {
  title?: string;
  items: ActionItem[];
}

export function ActionsMenu({
  label,
  groups,
}: {
  label: string;
  groups: ActionGroup[];
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [submenu, setSubmenu] = useState<{ items: ActionItem[]; top: number } | null>(null);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={(event) => {
          const target = event.currentTarget as unknown as {
            measureInWindow?: (
              callback: (x: number, y: number, width: number, height: number) => void,
            ) => void;
          };
          target.measureInWindow?.((x, y, _width, height) => setAnchor({ x, y: y + height + 4 }));
          setOpen(true);
        }}
        style={(state) => [styles.button, isHovered(state) && styles.buttonHover]}
      >
        <Text style={styles.buttonLabel}>{label}</Text>
        <WebIcon.chevronDown size={14} color={web.text} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть меню"
            style={StyleSheet.absoluteFill}
            onPress={close}
          />

          <View style={[styles.menu, { left: anchor.x, top: anchor.y }]}>
            {groups.map((group, index) => (
              <View key={group.title ?? index} style={index > 0 ? styles.group : null}>
                {group.title ? <Text style={styles.groupTitle}>{group.title}</Text> : null}

                {group.items.map((item) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: item.soon, expanded: Boolean(item.submenu) }}
                    disabled={item.soon}
                    onPress={(event) => {
                      if (item.submenu) {
                        const target = event.currentTarget as unknown as {
                          measureInWindow?: (
                            callback: (x: number, y: number, w: number, h: number) => void,
                          ) => void;
                        };
                        target.measureInWindow?.((_x, y) =>
                          setSubmenu({ items: item.submenu ?? [], top: y }),
                        );
                        return;
                      }

                      item.onPress?.();
                      close();
                    }}
                    style={(state) => [
                      styles.item,
                      isHovered(state) && !item.soon && styles.itemHover,
                    ]}
                  >
                    {item.icon ? <View style={styles.itemIcon}>{item.icon}</View> : null}
                    <Text
                      style={[
                        styles.itemLabel,
                        item.danger && styles.itemDanger,
                        item.soon && styles.itemSoon,
                      ]}
                    >
                      {item.label}
                    </Text>
                    {item.submenu ? (
                      <WebIcon.chevronRight size={14} color={web.textMuted} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ))}
          </View>

          {/* Вложенный список открывается справа от своего пункта — как у него. */}
          {submenu ? (
            <View style={[styles.menu, styles.submenu, { left: anchor.x + 292, top: submenu.top }]}>
              {submenu.items.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.soon }}
                  disabled={item.soon}
                  onPress={() => {
                    item.onPress?.();
                    close();
                  }}
                  style={(state) => [
                    styles.item,
                    isHovered(state) && !item.soon && styles.itemHover,
                  ]}
                >
                  <Text style={[styles.itemLabel, item.soon && styles.itemSoon]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

/** См. `Sidebar`: `hovered` есть только в вебе, и в типах React Native его нет. */
function isHovered(state: { pressed: boolean }): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
    backgroundColor: '#F7F7F8',
  },
  buttonHover: { backgroundColor: '#EFEFF0' },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  menu: {
    position: 'absolute',
    width: 292,
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    paddingVertical: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  submenu: { width: 240 },

  // Разделитель между разделами — тонкая линия, а не отступ.
  group: { borderTopWidth: 1, borderTopColor: '#EDEEEF', marginTop: 6, paddingTop: 6 },
  groupTitle: {
    fontFamily: WEB_FONT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: web.text,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },

  item: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 20 },
  itemHover: { backgroundColor: '#F5F6F7' },
  itemIcon: { width: 22, alignItems: 'center' },
  itemLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  itemDanger: { color: '#DB2828' },
  itemSoon: { color: '#B0B4B8' },
});
