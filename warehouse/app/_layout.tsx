import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CartProvider } from '../src/state/CartProvider';
import { DatabaseProvider } from '../src/state/DatabaseProvider';
import { LanguageProvider } from '../src/state/LanguageProvider';
import { PosSettingsProvider } from '../src/state/PosSettingsProvider';
import { ScannerProvider } from '../src/state/ScannerProvider';
import { colors, followSystemTheme } from '../src/ui/theme';
import { useDesktop } from '../src/ui/useDesktop';
import { web } from '../src/ui/webTheme';
import { Shell } from '../src/web/Shell';

export default function RootLayout() {
  // Светлое или тёмное — как в телефоне. У него после заката всё переключается
  // само, и программа не должна оставаться единственным белым пятном.
  //
  // Ставится до экранов и на весь их век: переменные оформления живут на
  // корне страницы, а не в разметке, и переживают любые переходы.
  useEffect(followSystemTheme, []);

  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        {/* Язык читается из базы, поэтому провайдер стоит внутри базы. */}
        <LanguageProvider>
          {/* Настройки кассы тоже из базы — и тоже нужны раньше экранов. */}
          <PosSettingsProvider>
            <CartProvider>
              <ScannerProvider>
                <StatusBar style="light" />
                <Shell>
                  <Screens />
                </Shell>
              </ScannerProvider>
            </CartProvider>
          </PosSettingsProvider>
        </LanguageProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

function Screens() {
  // В кабинете шапку рисует сам кабинет. Системная полоса поверх неё была бы
  // вторым заголовком одного и того же экрана.
  const desktop = useDesktop();
  const title = (name: string) => (desktop ? { headerShown: false } : { title: name });

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.primaryText,
        headerTitleStyle: { fontWeight: '600' },
        // В кабинете подложку задаёт его палитра, а не телефонная: иначе в
        // тёмном виде из-под экрана светит белый прямоугольник во всю
        // рабочую область.
        contentStyle: { backgroundColor: desktop ? web.pageBg : colors.bg },
        headerShown: !desktop,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen name="sale/new" options={{ headerShown: false }} />
      <Stack.Screen name="cashier" options={{ headerShown: false }} />
      <Stack.Screen name="counterparties" options={{ headerShown: false }} />
      <Stack.Screen name="reports/index" options={title('Отчёты')} />
      <Stack.Screen name="product/[id]" options={title('Товар')} />
      <Stack.Screen name="doc/new" options={title('Документ')} />
      <Stack.Screen name="money/new" options={title('Деньги')} />
      <Stack.Screen name="counterparty/[id]" options={title('Карточка')} />
      <Stack.Screen name="sale/[id]" options={title('Чек')} />
      {/*
       * Заголовки экранов, у которых своего нет.
       *
       * Без них телефон писал в шапке имя файла: «money/index» вместо
       * «Движение денег», «registers» вместо «Кассы». Нашлось обходом всех
       * строк телефонного «Меню» — четырнадцать экранов. Проверку, что у
       * каждого экрана есть название, держит тест `app-titles.test.ts`.
       */}
      <Stack.Screen name="money/index" options={title('Движение денег')} />
      <Stack.Screen name="registers" options={title('Кассы')} />
      <Stack.Screen name="shifts" options={title('Смены')} />
      <Stack.Screen name="accounts" options={title('Счета')} />
      <Stack.Screen name="stores" options={title('Магазины')} />
      <Stack.Screen name="staff" options={title('Сотрудники')} />
      <Stack.Screen name="company" options={title('Настройки компании')} />
      <Stack.Screen name="loyalty" options={title('Программа лояльности')} />
      <Stack.Screen name="print-forms" options={title('Печатные формы')} />
      <Stack.Screen name="trash" options={title('Корзина')} />
      <Stack.Screen name="billing" options={title('Тарифы и оплата')} />
      <Stack.Screen name="integrations" options={title('Интеграции')} />
      <Stack.Screen name="storefront" options={title('Интернет-витрина')} />
      <Stack.Screen name="partners" options={title('Партнёрская программа')} />
      <Stack.Screen
        name="scan"
        options={desktop ? { headerShown: false } : { title: 'Сканер', presentation: 'modal' }}
      />
    </Stack>
  );
}
