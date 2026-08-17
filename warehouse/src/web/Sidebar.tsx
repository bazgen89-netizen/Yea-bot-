import { useRouter, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MENU, MENU_FOOTER, menuFor, type MenuChild, type MenuEntry } from './menu';
import { usePermissions } from '../state/usePermissions';
import { useLanguage } from '../state/LanguageProvider';
import { WebIcon } from '../ui/icons';
import { SIDEBAR_WIDTH, SIDEBAR_SMALL_WIDTH, web, WEB_FONT } from '../ui/webTheme';

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

        {/* «Что нового» и остальное — часть того же прокручиваемого списка,
            отделённая чертой. Прижатым книзу блоком они наезжали на «Корзину»:
            на экране 900 точек оба оказывались на одной высоте. */}
        <View style={styles.divider} />

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
      </ScrollView>

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
            <WebIcon.rocket color={web.sidebarChild} />
          </BottomButton>
          <BottomButton label="Приложение для Android" onPress={() => router.push('/billing')}>
            <WebIcon.android color={web.sidebarChild} />
          </BottomButton>
          <BottomButton label="Приложение для iPhone" onPress={() => router.push('/billing')}>
            <WebIcon.apple color={web.sidebarChild} />
          </BottomButton>
        </>
      )}

      <BottomButton label={small ? 'Развернуть меню' : 'Свернуть меню'} onPress={onToggle}>
        {small ? (
          <WebIcon.chevronRight color={web.sidebarChild} />
        ) : (
          <WebIcon.chevronLeft color={web.sidebarChild} />
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
        {WebIcon[entry.icon]({ color: active ? web.sidebarText : tint, size: 16 })}
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

      {/* Треугольник, а не «галочка»: у него в разметке `icon caret down`,
          размером .8em и цветом rgba(0,0,0,.5). */}
      {expandable && !small ? (
        expanded ? (
          <WebIcon.caretUp color={web.sidebarChild} size={12} />
        ) : (
          <WebIcon.caretDown color={web.sidebarChild} size={12} />
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
  // `.create { padding: 5px 0 10px; height: 53px; opacity: .8 }`, а сама
  // кнопка внутри — во всю ширину за вычетом полей по 5.
  create: {
    backgroundColor: web.createButton,
    opacity: 0.8,
    marginHorizontal: 5,
    marginTop: 5,
    marginBottom: 10,
    height: 38,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createSmall: { marginHorizontal: 5 },
  createLabel: { color: '#FFFFFF', fontFamily: WEB_FONT, fontSize: 14, fontWeight: '400' },
  // `.item-block > .item`: отступ 12, поля 0 5px 1px, скругление 4.
  //
  // Высота не задана — её даёт содержимое: 12 сверху, 12 снизу и строка
  // 13 × 1.4285 ≈ 19. Сорок восемь, что стояли здесь раньше, лишние: с ними
  // тринадцать разделов и три нижних пункта переставали помещаться в окно,
  // и меню начинало прокручиваться там, где у него прокручивать нечего.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 12,
    marginHorizontal: 5,
    marginBottom: 1,
    borderRadius: 4,
    height: 43,
  },
  // `.smallMenu … .item { padding: 0; height: 40px; margin: 0 5px }`.
  rowSmall: { paddingLeft: 0, paddingRight: 0, justifyContent: 'center', height: 40 },
  // Активный и наведённый — его же значения: 8 % и 3 % чёрного, а не серый
  // из палитры. На белом фоне разница видна, и «примерно такой же серый»
  // читается как другой оттенок.
  rowActive: { backgroundColor: 'rgba(0,0,0,0.08)' },
  rowHover: { backgroundColor: 'rgba(0,0,0,0.03)' },
  // Значок — размером со строку: у Semantic UI `i.icon` внутри меню это
  // 1em, то есть те же 13 пунктов, при ширине 1.18em. Наши значки рисованные,
  // и 21 точка рядом с подписью в 13 смотрелась как другой набор.
  rowIcon: { width: 16, alignItems: 'center' },
  // `.item-block { font-size: 13px }` — свой размер, а не 14 из Semantic UI,
  // и начертание 500. Четырнадцать я взял из общего правила, не заметив,
  // что его собственная таблица стилей это правило перебивает.
  rowLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, fontWeight: '500', color: web.sidebarText },
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
  badgeText: { color: '#FFFFFF', fontFamily: WEB_FONT, fontSize: 10, fontWeight: '700' },
  // `.item-block .menu .item { padding: 8px 0 8px 23px }` — вложенный пункт
  // сдвинут на 23 от края меню, а не подведён под подпись родителя.
  child: {
    paddingLeft: 23,
    paddingRight: 12,
    height: 35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Размер вложенный пункт наследует у раздела — те же 13.
  childLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.sidebarChild },
  // `.ui.divider` — поля 1rem сверху и снизу.
  divider: {
    height: 1,
    backgroundColor: 'rgba(34,36,38,0.15)',
    marginVertical: 14,
    marginHorizontal: 5,
  },
  // `.bottom-menu { height: 40 }`, каждая ссылка — `flex: 1` во всю высоту.
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: web.sidebarBorder,
    height: 40,
  },
  bottomBarSmall: { justifyContent: 'center' },
  bottomButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
