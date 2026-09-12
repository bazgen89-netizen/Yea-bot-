import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { say } from '../src/ui/alert';
import { WebIcon } from '../src/ui/icons';
import { web, WEB_FONT } from '../src/ui/webTheme';

/**
 * «Лаборатория».
 *
 * Собрана его экраном: два пояснения сверху — про бета-версии и про фидбек, —
 * ниже карточки приложений. Пояснения перенесены дословно: они объясняют не
 * кнопку, а правило — пока приложение здесь, оно бесплатно, а по итогам
 * тестов его либо встроят, либо уберут.
 *
 * У него два приложения, оба открываются как отдельные сервисы на своих
 * адресах. У нас их пока нет, и карточки честно говорят об этом, а не
 * притворяются рабочими.
 */

interface App {
  title: string;
  description: string;
  color: string;
  icon: keyof typeof WebIcon;
}

const APPS: App[] = [
  {
    title: 'Модуль производства',
    description: 'Управление производственными процессами',
    color: '#F2711C',
    icon: 'goods',
  },
  {
    title: 'Зарплатный модуль',
    description: 'Расчёт и начисление заработной платы',
    color: '#21BA45',
    icon: 'money',
  },
];

export default function LabScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.panel}>
        <View style={styles.info}>
          <View style={styles.infoRow}>
            <WebIcon.lab size={22} color={web.textMuted} />
            <Text style={styles.infoText}>
              Здесь собраны бета-версии приложений, которые сейчас проходят тестирование. Пока они
              в лаборатории — доступ полностью бесплатный. После завершения тестов приложения будут
              либо встроены в сервис, либо убраны.
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <WebIcon.comment size={22} color={web.textMuted} />
            <Text style={styles.infoText}>
              Ваш фидбек и предложения напрямую влияют на судьбу каждого приложения — делитесь
              впечатлениями!
            </Text>
          </View>
        </View>

        <View style={styles.cards}>
          {APPS.map((app) => {
            const Icon = WebIcon[app.icon];
            return (
              <Pressable
                key={app.title}
                accessibilityRole="button"
                style={styles.card}
                onPress={() =>
                  say(
                    app.title,
                    'Приложение ещё не сделано. Карточка стоит здесь потому, что в лаборатории она есть у CloudShop, и раздел не должен выглядеть пустым.',
                  )
                }
              >
                <View style={[styles.cardTop, { backgroundColor: app.color }]}>
                  <Icon size={44} color="#FFFFFF" />
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.cardTitle}>{app.title}</Text>
                  <Text style={styles.cardDesc}>{app.description}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.pageBg },
  content: { padding: 26 },
  panel: { backgroundColor: '#FFFFFF', padding: 26, borderRadius: 3 },
  info: { gap: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  infoText: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.text, lineHeight: 23 },
  divider: { height: 1, backgroundColor: 'rgba(34,36,38,0.15)' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, marginTop: 30 },
  card: {
    width: 260,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
  },
  cardTop: { height: 110, alignItems: 'center', justifyContent: 'center' },
  cardBottom: { padding: 16, gap: 6 },
  cardTitle: { fontFamily: WEB_FONT, fontSize: 17, fontWeight: '500', color: web.text },
  cardDesc: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, lineHeight: 19 },
});
