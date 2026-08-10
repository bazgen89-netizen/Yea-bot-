import { useRouter, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MENU, MENU_FOOTER, menuFor, type MenuChild, type MenuEntry } from './menu';
import { usePermissions } from '../state/usePermissions';
import { useLanguage } from '../state/LanguageProvider';
import { WebIcon } from '../ui/icons';
import { SIDEBAR_WIDTH, SIDEBAR_SMALL_WIDTH, web } from '../ui/webTheme';

/** Боковое меню кабинета. Разделы с вложенными пунктами раскрываются. */
export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();

  // Раздел, открытый вручную. Пока его нет, раскрытым считается тот,
  // внутри которого мы сейчас находимся: перешли в «Клиенты» — «Контрагенты»
  // остаются раскрытыми, а не схлопываются, спрятав соседний пункт.
  const [picked, setPicked] = useState<string | null>(null);
  // Узкое меню — то же, что `body_smallMenu` в исходном кабинете: остаются
  // одни значки, а место отдаётся таблице.
  const [small, setSmall] = useState(false);

  // Меню собирается под права того, кто работает: у продавца нет ни денег,
  // ни отчётов, и показывать их, чтобы отказать при нажатии, незачем.
  const { allowed } = usePermissions();
  const menu = menuFor(allowed);

  const containing = menu.find((entry) =>
    entry.children?.some((child) => hrefPath(child.href) === pathname),
  )?.label;

  // Пустая строка означает «свернул руками» — не то же самое, что «не трогал».
  const open = picked === null ? (containing ?? null) : picked || null;

  const go = (href: Href | undefined) => {
    if (href) router.push(href);
  };

  return (
    <View style={[styles.sidebar, small && styles.sidebarSmall]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Создать документ"
        onPress={() => router.push('/new')}
        style={({ pressed }) => [styles.create, small && styles.createSmall, pressed && { opacity: 0.9 }]}
      >
        <Text style={styles.createLabel}>{small ? '+' : t('Создать документ')}</Text>
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false}>
        {menu.map((entry) => (
          <Section
            key={entry.label}
            entry={entry}
            pathname={pathname}
            small={small}
            open={open === entry.label}
            onToggle={() => setPicked(open === entry.label ? '' : entry.label)}
            onGo={go}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {MENU_FOOTER.map((entry) => (
          <Row
            key={entry.label}
            entry={entry}
            active={false}
            small={small}
            onPress={() => go(entry.href)}
            badge={entry.label === 'Что нового' ? 3 : undefined}
          />
        ))}
      </View>

      <BottomBar small={small} onToggle={() => setSmall((current) => !current)} />
    </View>
  );
}

/**
 * Нижний ряд: ускорение работы, ссылки на приложения и сворачивание меню.
 * Значки те же и в том же порядке, что в исходном кабинете.
 */
function BottomBar({ small, onToggle }: { small: boolean; onToggle: () => void }) {
  const router = useRouter();

  return (
    <View style={[styles.bottomBar, small && styles.bottomBarSmall]}>
      {small ? null : (
        <>
          <BottomButton label="Ускорить работу" onPress={() => router.push('/lab')}>
            <WebIcon.rocket color={web.sidebarIcon} />
          </BottomButton>
          <BottomButton label="Приложение для Android" onPress={() => router.push('/billing')}>
            <WebIcon.android color={web.sidebarIcon} />
          </BottomButton>
          <BottomButton label="Приложение для iPhone" onPress={() => router.push('/billing')}>
            <WebIcon.apple color={web.sidebarIcon} />
          </BottomButton>
        </>
      )}

      <BottomButton label={small ? 'Развернуть меню' : 'Свернуть меню'} onPress={onToggle}>
        {small ? (
          <WebIcon.chevronRight color={web.sidebarIcon} />
        ) : (
          <WebIcon.chevronLeft color={web.sidebarIcon} />
        )}
      </BottomButton>
    </View>
  );
}

function BottomButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={(state) => [styles.bottomButton, isHovered(state) && styles.rowHover]}
    >
      {children}
    </Pressable>
  );
}

function Section({
  entry,
  pathname,
  small,
  open,
  onToggle,
  onGo,
}: {
  entry: MenuEntry;
  pathname: string;
  small: boolean;
  open: boolean;
  onToggle: () => void;
  onGo: (href: Href | undefined) => void;
}) {
  const active = entry.href ? hrefPath(entry.href) === pathname : false;

  // В узком меню раскрывать нечего — вложенные пункты подписаны, а подписей
  // там нет. Нажатие на раздел ведёт в первый его пункт, чтобы значок не молчал.
  const collapsed = small && Boolean(entry.children);

  return (
    <View>
      <Row
        entry={entry}
        active={active}
        small={small}
        expandable={Boolean(entry.children)}
        expanded={open}
        onPress={() =>
          collapsed
            ? onGo(entry.children?.[0].href)
            : entry.children
              ? onToggle()
              : onGo(entry.href)
        }
      />

      {open &&
        !small &&
        entry.children?.map((child) => (
          <ChildRow
            key={child.label}
            child={child}
            active={hrefPath(child.href) === pathname}
            onPress={() => onGo(child.href)}
          />
        ))}
    </View>
  );
}

function Row({
  entry,
  active,
  small,
  expandable,
  expanded,
  onPress,
  badge,
}: {
  entry: MenuEntry;
  active: boolean;
  small?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const { t } = useLanguage();
  const tint = entry.dim ? web.sidebarDisabled : web.sidebarIcon;
  const label = t(entry.label);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded, selected: active }}
      onPress={onPress}
      style={(state) => [
        styles.row,
        small && styles.rowSmall,
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

      {small ? null : (
        <Text
          style={[styles.rowLabel, entry.dim && { color: web.sidebarDisabled }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}

      {expandable && !small ? (
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
  const { t } = useLanguage();

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
        {t(child.label)}
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
  sidebarSmall: { width: SIDEBAR_SMALL_WIDTH },
  create: {
    backgroundColor: web.createButton,
    margin: 16,
    marginBottom: 12,
    height: 52,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createSmall: { marginHorizontal: 10 },
  createLabel: { color: '#FFFFFF', fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingLeft: 26,
    paddingRight: 18,
    height: 50,
  },
  rowSmall: { paddingLeft: 0, paddingRight: 0, justifyContent: 'center' },
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
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: web.sidebarBorder,
    paddingHorizontal: 20,
    height: 46,
  },
  bottomBarSmall: { justifyContent: 'center', paddingHorizontal: 0 },
  bottomButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
