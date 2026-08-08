import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebIcon } from '../ui/icons';
import { HEADER_HEIGHT, web } from '../ui/webTheme';

/**
 * Шапка кабинета: логотип, название раздела, кнопка кассира и значки справа.
 *
 * Градиент собран из трёх полос, а не задан CSS: `react-native-web` переводит
 * стили в inline-CSS, и `linear-gradient` туда не попадает — а тянуть ради
 * одной полоски отдельную библиотеку не стоит.
 */
export function Header({ title, unread = 15 }: { title: string; unread?: number }) {
  const router = useRouter();

  return (
    <View style={styles.header}>
      <View style={[styles.band, styles.bandLeft]} />
      <View style={[styles.band, styles.bandMiddle]} />
      <View style={[styles.band, styles.bandRight]} />

      <Text style={styles.logo}>CloudShop</Text>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      <View style={styles.right}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Интерфейс кассира"
          onPress={() => router.push('/cashier')}
          style={({ pressed }) => [styles.cashier, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.cashierLabel}>Интерфейс кассира</Text>
        </Pressable>

        <HeaderButton label="Язык" onPress={() => router.push('/company')}>
          <WebIcon.language color={web.headerText} />
          <Text style={styles.languageLabel}>Русский</Text>
        </HeaderButton>

        <HeaderButton label="Сканировать штрихкод" onPress={() => router.push('/scan')}>
          <WebIcon.barcode color={web.headerText} />
        </HeaderButton>

        <HeaderButton label="Смены" onPress={() => router.push('/shifts')}>
          <WebIcon.calendar color={web.headerText} />
        </HeaderButton>

        <HeaderButton label="Уведомления" onPress={() => router.push('/lab')}>
          <WebIcon.bell color={web.headerText} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          ) : null}
        </HeaderButton>

        <HeaderButton label="Настройки компании" onPress={() => router.push('/company')}>
          <View style={styles.account}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>W</Text>
            </View>
            <View>
              <Text style={styles.accountName}>waystea</Text>
              <Text style={styles.accountRole}>Владелец</Text>
            </View>
          </View>
        </HeaderButton>
      </View>
    </View>
  );
}

/** Значок в шапке. Все они нажимаются — мёртвых кнопок в шапке нет. */
function HeaderButton({
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
      style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 28,
    overflow: 'hidden',
  },
  band: { position: 'absolute', top: 0, bottom: 0 },
  bandLeft: { left: 0, width: '34%', backgroundColor: web.headerFrom },
  bandMiddle: { left: '34%', width: '33%', backgroundColor: '#01699E' },
  bandRight: { left: '67%', right: 0, backgroundColor: web.headerTo },
  logo: { color: web.headerText, fontSize: 25, fontWeight: '700', letterSpacing: -0.5 },
  title: { flex: 1, color: web.headerText, fontSize: 21, marginLeft: 24 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  cashier: {
    backgroundColor: web.headerButton,
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashierLabel: { color: web.headerText, fontSize: 15 },
  headerButton: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  languageLabel: { color: web.headerText, fontSize: 15 },
  badge: {
    position: 'absolute',
    right: -8,
    top: -7,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: web.headerText, fontSize: 17, fontWeight: '700' },
  accountName: { color: web.headerText, fontSize: 15 },
  accountRole: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
});
