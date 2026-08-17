import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Dropdown, type Option } from './Dropdown';
import { LANGUAGES, labelFor, type LanguageCode } from '../i18n/languages';
import { useLanguage } from '../state/LanguageProvider';
import { WebIcon } from '../ui/icons';
import { HEADER_HEIGHT, web, WEB_FONT } from '../ui/webTheme';

/**
 * Шапка кабинета: логотип, название раздела, кнопка кассира и значки справа.
 *
 * Градиент собран из трёх полос, а не задан CSS: `react-native-web` переводит
 * стили в inline-CSS, и `linear-gradient` туда не попадает — а тянуть ради
 * одной полоски отдельную библиотеку не стоит.
 */
/**
 * Заливка шапки: `linear-gradient(310deg, #01579b, #0288d1)`.
 *
 * Плавного перехода в React Native нет, поэтому он набран полосами. Важно
 * направление: 310 градусов уводят переход к верхнему левому углу, значит
 * **светлое — слева**, у логотипа, а тёмное уходит вправо. Раньше полосы
 * стояли наоборот, и шапка была темнее там, где у него светлее.
 */
const BANDS = [
  '#0285CE',
  '#027FC7',
  '#0279C0',
  '#0273B9',
  '#016CB3',
  '#0166AC',
  '#0160A5',
  '#015A9E',
];

const LANGUAGE_OPTIONS: Option<LanguageCode>[] = LANGUAGES.map((language) => ({
  value: language.code,
  label: language.label,
}));

export function Header({ title, unread = 15 }: { title: string; unread?: number }) {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();

  return (
    <View style={styles.header}>
      {BANDS.map((color, index) => (
        <View
          key={color}
          style={[
            styles.band,
            {
              left: `${(index / BANDS.length) * 100}%`,
              width: `${100 / BANDS.length + 0.2}%`,
              backgroundColor: color,
            },
          ]}
        />
      ))}

      <Text style={styles.logo}>Wayshop</Text>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      <View style={styles.right}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Интерфейс кассира')}
          onPress={() => router.push('/cashier')}
          style={({ pressed }) => [styles.cashier, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.cashierLabel}>{t('Интерфейс кассира')}</Text>
        </Pressable>

        <View style={styles.language}>
          <WebIcon.language color={web.headerText} />
          <Dropdown
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={setLanguage}
            variant="header"
            label={t('Язык')}
          />
        </View>

        <HeaderButton label={t('Сканировать штрихкод')} onPress={() => router.push('/scan')}>
          <WebIcon.barcode color={web.headerText} />
        </HeaderButton>

        <HeaderButton label={t('Смены')} onPress={() => router.push('/shifts')}>
          <WebIcon.calendar color={web.headerText} />
        </HeaderButton>

        <HeaderButton label={t('Уведомления')} onPress={() => router.push('/lab')}>
          <WebIcon.bell color={web.headerText} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          ) : null}
        </HeaderButton>

        <HeaderButton label={t('Настройки компании')} onPress={() => router.push('/company')}>
          <View style={styles.account}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>W</Text>
            </View>
            <View>
              <Text style={styles.accountName}>waystea</Text>
              <Text style={styles.accountRole}>{t('Владелец')}</Text>
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
  // Логотип занимает у него 122 точки при высоте шапки 46; название раздела —
  // 20 пунктов начертанием 300 (`.item.title`).
  logo: { color: web.headerText, fontFamily: WEB_FONT, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  title: {
    flex: 1,
    color: web.headerText,
    fontFamily: WEB_FONT,
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 24,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  cashier: {
    backgroundColor: web.headerButton,
    height: 32,
    paddingHorizontal: 22,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashierLabel: { color: web.headerText, fontFamily: WEB_FONT, fontSize: 15 },
  headerButton: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  language: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  badgeText: { color: '#FFFFFF', fontFamily: WEB_FONT, fontSize: 10, fontWeight: '700' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Снимок его шапки: аватар 34 × 34, круглый.
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: web.headerText, fontFamily: WEB_FONT, fontSize: 17, fontWeight: '700' },
  accountName: { color: web.headerText, fontFamily: WEB_FONT, fontSize: 15 },
  accountRole: { color: 'rgba(255,255,255,0.8)', fontFamily: WEB_FONT, fontSize: 13 },
});
