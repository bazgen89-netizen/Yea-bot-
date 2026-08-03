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
        stock: product.stock,
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
    }),
    [lines, discount, add, setQty, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart вызван вне CartProvider');
  return value;
}
