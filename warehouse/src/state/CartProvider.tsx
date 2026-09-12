import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { addToCart, cartTotals, setCartQty } from '../domain/cart';
import type { CartLine, Id, ProductWithStock } from '../domain/types';

interface CartContextValue {
  lines: CartLine[];
  /** Скидка на весь чек, копейки. */
  discount: number;
  totals: ReturnType<typeof cartTotals>;
  add: (product: ProductWithStock, qty?: number) => void;
  setQty: (productId: Id, qty: number) => void;
  remove: (productId: Id) => void;
  setDiscount: (kopecks: number) => void;
  clear: () => void;
  /**
   * Положить в корзину готовый чек — тот, что достали из очереди.
   *
   * Не `clear` плюс `add` по одному: у отложенного чека свои количества и
   * своя скидка, а `add` считал бы их заново от карточки товара.
   */
  replace: (lines: CartLine[], discount: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Корзина живёт в памяти до оплаты — незавершённый чек не должен попадать
 * в базу и портить остатки и отчёты.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);

  const add = useCallback((product: ProductWithStock, qty = 1000) => {
    setLines((current) =>
      addToCart(current, {
        product_id: product.id,
        name: product.name,
        unit: product.unit,
        qty,
        price: product.sale_price,
        cost_price: product.cost_price,
        // Скидка, заведённая в карточке товара, действует и на кассе: её
        // для того и заводят. Раньше касса продавала по полной цене, и
        // «Скидка 10 %» в карточке ни на что не влияла.
        discount_bp: product.discount_bp,
        stock: product.stock,
        photo_uri: product.photo_uri,
      }),
    );
  }, []);

  const setQty = useCallback((productId: Id, qty: number) => {
    setLines((current) => setCartQty(current, productId, qty));
  }, []);

  const remove = useCallback((productId: Id) => {
    setLines((current) => setCartQty(current, productId, 0));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setDiscount(0);
  }, []);

  const replace = useCallback((next: CartLine[], nextDiscount: number) => {
    setLines(next);
    setDiscount(nextDiscount);
  }, []);

  const value = useMemo(
    () => ({
      lines,
      discount,
      totals: cartTotals(lines, discount),
      add,
      setQty,
      remove,
      setDiscount,
      clear,
      replace,
    }),
    [lines, discount, add, setQty, remove, clear, replace],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart вызван вне CartProvider');
  return value;
}
