import { useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Translated';

import { pos } from '../ui/webTheme';

/**
 * Прокручиваемая область со **своим** ползунком.
 *
 * Браузерный не годится: на маке он наложенный и исчезает, стоит убрать руку
 * с трекпада, — а понять, далеко ли до конца витрины, нужно всё время. Стилями
 * его тоже не заставить: React Native Web дописывает своим спискам
 * `::-webkit-scrollbar{display:none}`, и правило приходит позже нашего.
 *
 * Поэтому ползунок нарисован сам: серая скруглённая полоска у правого края,
 * длина — доля видимого от всего, положение — доля прокрученного. Пока
 * прокручивать нечего, её нет вовсе.
 */
export function Scrollable({
  children,
  style,
  contentContainerStyle,
  horizontal,
  toTop,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  horizontal?: boolean;
  /**
   * Показывать зелёную кнопку «наверх», когда уехали далеко вниз.
   *
   * Витрина длинная: докрутить до конца легко, а вернуться — нет. Кнопка
   * появляется, только когда возвращаться и правда далеко.
   */
  toTop?: boolean;
}) {
  const [view, setView] = useState(0);
  const [content, setContent] = useState(0);
  const [deep, setDeep] = useState(false);
  const list = useRef<ScrollView>(null);
  const offset = useRef(new Animated.Value(0)).current;

  const scrollable = content > view + 1;
  // Ползунок не короче 30 точек: иначе на длинном каталоге он превращается
  // в точку, по которой ничего не понять.
  const thumb = scrollable ? Math.max(30, (view / content) * view) : 0;
  const travel = Math.max(1, content - view);

  return (
    <View style={[styles.root, style]}>
      <ScrollView
        ref={list}
        horizontal={horizontal}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { [horizontal ? 'x' : 'y']: offset } } }],
          {
            useNativeDriver: false,
            listener: (event) => {
              if (!toTop) return;
              const { y } = (event as { nativeEvent: { contentOffset: { y: number } } })
                .nativeEvent.contentOffset;
              // Порог — экран с небольшим: пока прокрутили чуть-чуть, вернуться
              // проще колесом, и кнопка только загораживала бы товар.
              setDeep(y > view * 1.2);
            },
          },
        )}
        onLayout={(event) =>
          setView(
            horizontal ? event.nativeEvent.layout.width : event.nativeEvent.layout.height,
          )
        }
        onContentSizeChange={(width, height) => setContent(horizontal ? width : height)}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>

      {scrollable ? (
        <Animated.View
          pointerEvents="none"
          style={[
            horizontal ? styles.thumbH : styles.thumbV,
            horizontal
              ? { width: thumb }
              : { height: thumb },
            {
              transform: [
                {
                  [horizontal ? 'translateX' : 'translateY']: offset.interpolate({
                    inputRange: [0, travel],
                    outputRange: [0, view - thumb],
                    extrapolate: 'clamp',
                  }),
                } as never,
              ],
            },
          ]}
        />
      ) : null}

      {toTop && deep ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Наверх"
          onPress={() => list.current?.scrollTo({ y: 0, animated: true })}
          style={styles.toTop}
        >
          <Text style={styles.toTopArrow}>↑</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative', overflow: 'hidden' },
  thumbV: {
    position: 'absolute',
    top: 0,
    right: 2,
    width: 6,
    borderRadius: 3,
    backgroundColor: pos.muted,
    opacity: 0.45,
  },
  // Зелёный кружок со стрелкой — как у них: в правом нижнем углу списка.
  toTop: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E8E3E',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  toTopArrow: { fontFamily: pos.font, fontSize: 30, color: '#FFFFFF', lineHeight: 34 },
  thumbH: {
    position: 'absolute',
    left: 0,
    bottom: 2,
    height: 6,
    borderRadius: 3,
    backgroundColor: pos.muted,
    opacity: 0.45,
  },
});
