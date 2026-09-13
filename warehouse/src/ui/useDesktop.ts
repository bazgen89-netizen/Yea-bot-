import { useWindowDimensions } from 'react-native';

import { DESKTOP_WIDTH } from './webTheme';

/**
 * Широкий экран — показываем кабинет, узкий — телефонную вёрстку.
 *
 * Меряем ширину окна, а не платформу: браузер на телефоне и окно, ужатое
 * в половину экрана, должны вести себя одинаково, а на планшете в альбомной
 * ориентации кабинет уместен.
 */
export function useDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= DESKTOP_WIDTH;
}
