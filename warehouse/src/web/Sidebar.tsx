import { useRouter, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MENU, MENU_FOOTER, type MenuChild, type MenuEntry } from './menu';
import { WebIcon } from '../ui/icons';
import { SIDEBAR_WIDTH, web } from '../ui/webTheme';

/** Боковое меню кабинета. Разделы с вложенными пунктами раскрываются. */
export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  // Раскрытым держим тот раздел, внутри которого сейчас находимся.
  const [open, setOpen] = useState<string | null>(() => {
    const active = MENU.find((entry) =>
      entry.children?.some((child) => child.href && hrefPath(child.href) === pathname),
    );
    return active?.label ?? null;
  });

  const go = (href: Href | undefined, soon: boolean | undefined) => {
    if (soon || !href) return;
    router.push(href);
  };

  return (
    <View style={styles.sidebar}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/new')}
        style={({ pressed }) => [styles.create, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.createLabel}>Создать документ</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false}>
        {MENU.map((entry) => (
          <Section
            key={entry.label}
            entry={entry}
            pathname={pathname}
            open={open === entry.label}
            onToggle={() => setOpen(open === entry.label ? null : entry.label)}
            onGo={go}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {MENU_FOOTER.map((entry) => (
          <Row key={entry.label} entry={entry} active={false} onPress={() => {}} badge={
            entry.label === 'Что нового' ? 3 : undefined
          } />
        ))}
      </View>
    </View>
  );
}

function Section({
  entry,
  pathname,
  open,
  onToggle,
  onGo,
}: {
  entry: MenuEntry;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onGo: (href: Href | undefined, soon: boolean | undefined) => void;
}) {
  const active = entry.href ? hrefPath(entry.href) === pathname : false;

  return (
    <View>
      <Row
        entry={entry}
        active={active}
        expandable={Boolean(entry.children)}
        expanded={open}
        onPress={() => (entry.children ? onToggle() : onGo(entry.href, entry.soon))}
      />

      {open &&
        entry.children?.map((child) => (
          <ChildRow
            key={child.label}
            child={child}
            active={child.href ? hrefPath(child.href) === pathname : false}
            onPress={() => onGo(child.href, child.soon)}
          />
        ))}
    </View>
  );
}

function Row({
  entry,
  active,
  expandable,
  expanded,
  onPress,
  badge,
}: {
  entry: MenuEntry;
  active: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const tint = entry.dim || entry.soon ? web.sidebarDisabled : web.sidebarIcon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded, selected: active }}
      onPress={onPress}
      style={(state) => [
        styles.row,
        active && styles.rowActive,
        isHovered(state) && !active && styles.rowHover,
      ]}
    >
      <View style={styles.rowIcon}>
        {WebIcon[entry.icon]({ color: active ? web.sidebarText : tint })}
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>

      <Text
        style={[styles.rowLabel, (entry.dim || entry.soon) && { color: web.sidebarDisabled }]}
        numberOfLines={1}
      >
        {entry.label}
      </Text>

      {expandable ? (
        expanded ? (
          <WebIcon.chevronUp color={web.sidebarIcon} />
        ) : (
          <WebIcon.chevronDown color={web.sidebarIcon} />
        )
      ) : null}
    </Pressable>
  );
}

function ChildRow({
  child,
  active,
  onPress,
}: {
  child: MenuChild;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={(state) => [
        styles.child,
        active && styles.rowActive,
        isHovered(state) && !active && styles.rowHover,
      ]}
    >
      {child.accent ? <WebIcon.download color={web.link} /> : null}
      <Text
        style={[
          styles.childLabel,
          child.accent && { color: web.link },
          active && { color: web.sidebarText, fontWeight: '500' },
        ]}
        numberOfLines={1}
      >
        {child.label}
      </Text>
    </Pressable>
  );
}

/**
 * Наведение мыши. `react-native-web` кладёт `hovered` в тот же объект
 * состояния, что и `pressed`, но в типах React Native его нет — на телефоне
 * мыши не бывает. Достаём аккуратно, чтобы не приводить весь объект к any.
 */
function isHovered(state: { pressed: boolean }): boolean {
  return (state as { hovered?: boolean }).hovered === true || state.pressed;
}

/** Путь из Href — в меню он нужен только для сравнения с текущим адресом. */
function hrefPath(href: Href): string {
  return typeof href === 'string' ? href.split('?')[0] : String(href.pathname ?? '');
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: web.sidebarBg,
    borderRightWidth: 1,
    borderRightColor: web.sidebarBorder,
  },
  create: {
    backgroundColor: web.createButton,
    margin: 16,
    marginBottom: 12,
    height: 52,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createLabel: { color: '#FFFFFF', fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingLeft: 26,
    paddingRight: 18,
    height: 50,
  },
  rowActive: { backgroundColor: web.sidebarActive },
  rowHover: { backgroundColor: '#F7F7F7' },
  rowIcon: { width: 22, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 16, color: web.sidebarText },
  badge: {
    position: 'absolute',
    left: -8,
    top: -6,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: web.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  child: { justifyContent: 'center', paddingLeft: 66, paddingRight: 18, height: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  childLabel: { flex: 1, fontSize: 15, color: web.sidebarChild },
  footer: { borderTopWidth: 1, borderTopColor: web.sidebarBorder, paddingVertical: 6 },
});
