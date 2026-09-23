import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { открытьЧат } from '../../state/aiChat';
import { WebIcon } from '../../ui/icons';
import { useDesktop } from '../../ui/useDesktop';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/**
 * «Тарифы и оплата».
 *
 * У CloudShop здесь тариф, срок действия и история платежей. У Wayshop
 * тарифа нет: программа своя и живёт на своём сайте. Раньше тут стояла
 * заглушка «Раздел в работе» — но работать здесь не над чем, а страница,
 * которая обещает то, чего не будет, хуже честной.
 *
 * Поэтому здесь сказано то, что правда: абонентской платы нет, и что в
 * хозяйстве вокруг программы стоит денег, а что даром. Особенно — про
 * ИИ-помощника: Вазген убрал Клода именно как платного, и из оставшихся
 * бесплатный только Gemini.
 */

interface Пункт {
  что: string;
  сколько: string;
  пояснение: string;
  даром?: boolean;
}

const ПУНКТЫ: Пункт[] = [
  {
    что: 'Сама программа Wayshop',
    сколько: 'Бесплатно',
    пояснение: 'Программа ваша: ни подписки, ни платы за кассу или сотрудника.',
    даром: true,
  },
  {
    что: 'Сайт waystea.ru',
    сколько: 'По вашему хостингу',
    пояснение: 'Программа лежит на вашем сайте под паролем. Отдельно за неё не платится.',
  },
  {
    что: 'ИИ-помощник — Gemini',
    сколько: 'Бесплатно',
    пояснение: 'Ключ выдаёт Google даром; есть ограничение по числу вопросов в минуту.',
    даром: true,
  },
  {
    что: 'ИИ-помощник — DeepSeek и ChatGPT',
    сколько: 'По вашему ключу',
    пояснение: 'Вопросы оплачиваются с баланса в их личных кабинетах. DeepSeek — копейки за вопрос.',
  },
  {
    что: 'Приложение для Android',
    сколько: 'Бесплатно',
    пояснение: 'Собирается сервисом Expo на бесплатном тарифе и ставится файлом, без магазина.',
    даром: true,
  },
  {
    что: 'Приложение в App Store для iPhone',
    сколько: '$99 в год',
    пояснение:
      'Столько стоит аккаунт разработчика Apple. Без него на iPhone — сайт с иконкой «На экран Домой».',
  },
];

export function Billing() {
  const router = useRouter();
  const desktop = useDesktop();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {desktop ? <Text style={webText.pageTitle}>Тарифы и оплата</Text> : null}

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Абонентской платы нет</Text>
        <Text style={styles.heroText}>
          Wayshop — ваша программа, а не подписка. Ниже — что в хозяйстве вокруг неё стоит денег,
          а что даром.
        </Text>
      </View>

      <View style={styles.list}>
        {ПУНКТЫ.map((пункт) => (
          <View key={пункт.что} style={styles.item}>
            <View style={styles.itemMain}>
              <Text style={styles.itemTitle}>{пункт.что}</Text>
              <Text style={styles.itemNote}>{пункт.пояснение}</Text>
            </View>
            <Text style={[styles.price, пункт.даром && styles.priceFree]}>{пункт.сколько}</Text>
          </View>
        ))}
      </View>

      {/* Не синий текст в никуда: кнопка ведёт туда, где ключ и вписывают. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => (desktop ? открытьЧат() : router.push('/assistant'))}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
      >
        <WebIcon.sparkles size={16} color="#FFFFFF" />
        <Text style={styles.buttonText}>Открыть ИИ-помощника</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 22, gap: 20, maxWidth: 820, width: '100%' },
  hero: {
    borderRadius: 12,
    padding: 20,
    gap: 6,
    backgroundColor: web.pageBg,
  },
  heroTitle: { fontFamily: WEB_FONT, fontSize: 20, fontWeight: '600', color: web.text },
  heroText: { fontFamily: WEB_FONT, fontSize: 14.5, lineHeight: 21, color: web.textMuted },
  list: { borderWidth: 1, borderColor: web.border, borderRadius: 12, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  itemMain: { flex: 1, gap: 3 },
  itemTitle: { fontFamily: WEB_FONT, fontSize: 15, fontWeight: '600', color: web.text },
  itemNote: { fontFamily: WEB_FONT, fontSize: 13, lineHeight: 18, color: web.textMuted },
  price: { fontFamily: WEB_FONT, fontSize: 14, fontWeight: '600', color: web.text, textAlign: 'right' },
  priceFree: { color: '#16A34A' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: web.action,
  },
  buttonText: { fontFamily: WEB_FONT, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});
