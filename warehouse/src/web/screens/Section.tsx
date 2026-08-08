import { StyleSheet, Text, View } from 'react-native';

import { WebIcon } from '../../ui/icons';
import { web, webText } from '../../ui/webTheme';

/**
 * Раздел, экран которого ещё не собран.
 *
 * Существует, чтобы пункт меню открывал настоящую страницу с правильным
 * заголовком, а не молчал в ответ на нажатие. Нажатие, после которого ничего
 * не происходит, читается как поломка; страница, которая честно говорит, что
 * в ней будет, — как незаконченная работа, и это правда.
 */
export function Section({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.screen}>
      <Text style={webText.pageTitle}>{title}</Text>
      <View style={styles.card}>
        <WebIcon.lab size={40} color="#D3D6D9" />
        <Text style={styles.note}>{note}</Text>
        <Text style={styles.hint}>Раздел в работе — скоро появится здесь.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg, padding: 26, gap: 26 },
  card: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingVertical: 64,
    alignItems: 'center',
    gap: 14,
  },
  note: { fontSize: 17, color: web.text, textAlign: 'center', maxWidth: 620 },
  hint: { fontSize: 14, color: web.textMuted },
});
