import { usePathname, useGlobalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ЧатИИ } from './AiChat';
import { Header } from './Header';
import { startsInCashier } from './openCashier';
import { Cashier } from './screens/Cashier';
import { Sidebar } from './Sidebar';
import { titleFor } from './menu';
import { закрытьЧат, useЧатОткрыт } from '../state/aiChat';
import { useLanguage } from '../state/LanguageProvider';
import { useDesktop } from '../ui/useDesktop';
import { web } from '../ui/webTheme';

/**
 * Обёртка приложения: на широком экране рисует кабинет — шапку сверху,
 * меню слева, содержимое справа. На узком отдаёт содержимое как есть,
 * и работает привычная телефонная вёрстка.
 *
 * Экран кассира занимает окно целиком: там своя шапка и своё меню внизу.
 */
export function Shell({ children }: { children: ReactNode }) {
  const desktop = useDesktop();
  const pathname = usePathname();
  // В раскладке параметры экрана видны только через глобальный хук.
  const params = useGlobalSearchParams<{ kind?: string; type?: string }>();
  const { tp } = useLanguage();
  const чатОткрыт = useЧатОткрыт();

  /**
   * Окно, открытое кассой, — это касса, и ничего кроме.
   *
   * Не переход маршрутизатором, а прямая отрисовка: у страницы, открытой
   * файлом с диска, адреса вида `/cashier` не существует, и переход в него
   * приходилось бы делать после запуска — окно успевало моргнуть кабинетом.
   * Метку `#cashier` ставит `openCashierWindow`, и по ней окно сразу знает,
   * чем ему быть.
   */
  if (startsInCashier() && (pathname === '/' || pathname.startsWith('/cashier'))) {
    return <Cashier />;
  }

  // Экран кассира занимает окно целиком: у него своя шапка и своё меню внизу,
  // и уйти оттуда можно кнопкой «Меню».
  if (!desktop || pathname.startsWith('/cashier')) return <>{children}</>;

  return (
    <View style={styles.shell}>
      <Header title={tp(titleFor(pathname, params.kind, params.type))} />
      <View style={styles.body}>
        <Sidebar />
        <View style={styles.content}>{children}</View>
        {/* Чат поверх страницы, а не вместо неё: спросил — и видишь, о чём
            спрашивал, в самой таблице слева. На странице самого чата панель
            не нужна — он и так на весь экран. */}
        {чатОткрыт && !pathname.startsWith('/assistant') ? (
          <ЧатИИ вид="панель" onClose={закрытьЧат} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: web.bg },
  body: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, backgroundColor: web.bg },
});
