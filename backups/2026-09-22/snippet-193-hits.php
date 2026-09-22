/**
 * Waystea: «Хиты продаж» по реальным заказам.
 *
 * Раньше хитов на главной было два: вручную набранный список из 17 id
 * в шорткоде Elementor и блок из WPCode по метке hity-prodazh, который
 * рисовался на wp_footer — то есть ПОД подвалом. Оставлен один блок,
 * он же встал на место списка, выше подвала.
 *
 * Рейтинг считается по числу оплаченных заказов, в которых товар
 * встретился, а не по количеству штук: в заказах количество местами
 * означает граммы (100 «штук» молочного улуна за 990 ₽), а в заказе
 * 14616 в количество вбито 4 444 444 444 444 — он из расчёта исключён.
 * Выручка идёт только на разрешение ничьих.
 *
 * Считается раз в 12 часов и кладётся в transient: на каждый показ
 * страницы перебирать заказы незачем.
 */

define( 'WAYSTEA_HITS_BAD_ORDER', 14616 );   // заказ с мусорным количеством
define( 'WAYSTEA_HITS_SANE_LINE', 1000000 ); // строка дороже — считаем мусором

function waystea_hits_ids( $limit = 8 ) {
	$cached = get_transient( 'waystea_hits_rank' );
	if ( ! is_array( $cached ) ) {
		$cached = waystea_hits_calc();
		set_transient( 'waystea_hits_rank', $cached, 12 * HOUR_IN_SECONDS );
	}
	return array_slice( $cached, 0, (int) $limit );
}

/**
 * Рейтинг из кассы, если он загружен.
 *
 * Приложение «склад и касса» держит базу в браузере владельца, снаружи её
 * не прочитать. Когда он присылает резервную копию `waystea-<дата>.sqlite`
 * или ключ CloudShop, топ считается отдельно и кладётся в опцию
 * `waystea_hits_pos` — массивом id товаров в порядке продаж.
 *
 * Опция старше расчёта по заказам сайта: касса знает про три офлайн-точки,
 * сайт — только про свои 83 заказа.
 */
function waystea_hits_pos() {
	$ids = get_option( 'waystea_hits_pos' );
	if ( ! is_array( $ids ) || ! $ids ) {
		return array();
	}
	$out = array();
	foreach ( $ids as $pid ) {
		$p = wc_get_product( (int) $pid );
		if ( $p && 'publish' === $p->get_status() && $p->is_in_stock() ) {
			$out[] = (int) $pid;
		}
	}
	return $out;
}

function waystea_hits_calc() {
	$pos = waystea_hits_pos();
	if ( $pos ) {
		return $pos;
	}

	if ( ! function_exists( 'wc_get_orders' ) ) {
		return array();
	}
	$orders = wc_get_orders( array(
		'limit'  => -1,
		'status' => array( 'processing', 'completed', 'on-hold' ),
	) );

	$orders_with = array();
	$revenue     = array();
	foreach ( $orders as $order ) {
		if ( WAYSTEA_HITS_BAD_ORDER === $order->get_id() ) {
			continue;
		}
		$seen = array();
		foreach ( $order->get_items() as $item ) {
			$pid = $item->get_product_id();
			if ( ! $pid ) {
				continue;
			}
			$total = (float) $item->get_total();
			if ( $total > WAYSTEA_HITS_SANE_LINE ) {
				continue;
			}
			$seen[ $pid ] = true;
			$revenue[ $pid ] = ( isset( $revenue[ $pid ] ) ? $revenue[ $pid ] : 0 ) + $total;
		}
		foreach ( array_keys( $seen ) as $pid ) {
			$orders_with[ $pid ] = ( isset( $orders_with[ $pid ] ) ? $orders_with[ $pid ] : 0 ) + 1;
		}
	}

	$rows = array();
	foreach ( $orders_with as $pid => $n ) {
		$p = wc_get_product( $pid );
		if ( ! $p || 'publish' !== $p->get_status() || ! $p->is_in_stock() ) {
			continue;
		}
		if ( has_term( 'posuda', 'product_cat', $pid ) ) {
			continue;   // блок про чай, посуда в него не идёт
		}
		$rows[] = array(
			'id'      => (int) $pid,
			'orders'  => (int) $n,
			'revenue' => isset( $revenue[ $pid ] ) ? (float) $revenue[ $pid ] : 0,
		);
	}
	usort( $rows, function ( $a, $b ) {
		if ( $a['orders'] !== $b['orders'] ) {
			return $b['orders'] - $a['orders'];
		}
		return ( $b['revenue'] < $a['revenue'] ) ? -1 : ( ( $b['revenue'] > $a['revenue'] ) ? 1 : 0 );
	} );

	$ids = wp_list_pluck( $rows, 'id' );

	// Если заказов совсем мало — дополняем ручной меткой владельца,
	// чтобы блок не выглядел полупустым.
	if ( count( $ids ) < 4 ) {
		$manual = wc_get_products( array(
			'status'    => 'publish',
			'limit'     => 8,
			'tax_query' => array(
				array( 'taxonomy' => 'product_tag', 'field' => 'slug', 'terms' => 'hity-prodazh' ),
			),
		) );
		foreach ( $manual as $p ) {
			if ( ! in_array( $p->get_id(), $ids, true ) ) {
				$ids[] = $p->get_id();
			}
		}
	}
	return $ids;
}

/** Карточка одного товара — та же вёрстка, что была у блока в WPCode. */
function waystea_hits_card( $p ) {
	$img   = $p->get_image_id() ? wp_get_attachment_image_url( $p->get_image_id(), 'woocommerce_thumbnail' ) : wc_placeholder_img_src();
	$url   = $p->get_permalink();
	$name  = $p->get_name();
	$out   = '<div style="background:#fff;border-radius:9px;overflow:hidden;border:1px solid #f0ebe2;display:flex;flex-direction:column;">';
	$out  .= '<a href="' . esc_url( $url ) . '"><img src="' . esc_url( $img ) . '" alt="' . esc_attr( $name ) . '" loading="lazy" style="width:100%;aspect-ratio:1/1;height:auto;object-fit:cover;display:block;"></a>';
	$out  .= '<div style="padding:9px;flex:1;display:flex;flex-direction:column;">';
	$out  .= '<a href="' . esc_url( $url ) . '" style="font-size:12px;font-weight:600;color:#2c1810;text-decoration:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:5px;line-height:1.3;min-height:2.6em;">' . esc_html( mb_substr( $name, 0, 42 ) ) . '</a>';
	$out  .= '<div style="font-size:12px;font-weight:700;color:#c9a84c;margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' . $p->get_price_html() . '</div>';
	$out  .= '<a href="' . esc_url( $url ) . '" style="display:block;margin-top:auto;background:#2c1810;color:#fff;text-align:center;padding:6px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;">В корзину</a>';
	$out  .= '</div></div>';
	return $out;
}

function waystea_hits_grid( $ids ) {
	$out = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:12px;align-items:stretch;">';
	$n   = 0;
	foreach ( $ids as $pid ) {
		$p = wc_get_product( $pid );
		if ( ! $p ) {
			continue;
		}
		$out .= waystea_hits_card( $p );
		$n++;
	}
	$out .= '</div>';
	return $n ? $out : '';
}

/**
 * Виджет-шорткод Elementor на главной отдавался шириной 380 px при экране
 * 1440: он лежит в контейнере с flex-direction: column и не растягивается.
 * Сетка с auto-fill в таком родителе считает ширину по содержимому и
 * схлопывается в один-два столбца — блок вставал вертикальной лентой,
 * а карточки выглядели огромными. Изнутри блока ширину родителя
 * средствами CSS не изменить, поэтому правило выдаётся вместе с разметкой.
 */
function waystea_hits_css() {
	static $done = false;
	if ( $done ) {
		return '';
	}
	$done = true;
	return '<style>'
		. '.elementor-widget-shortcode:has(.waystea-hits),'
		. '.elementor-element-05f2fb1{width:100%!important;max-width:100%!important;}'
		. '.waystea-hits{width:100%;}'
		. '@media(max-width:600px){.waystea-hits{padding:28px 12px!important;}}'
		. '</style>';
}

/** [waystea_hits] — блок на главной: три ряда по восемь и кнопка на полный список. */
add_shortcode( 'waystea_hits', function () {
	$grid = waystea_hits_grid( waystea_hits_ids( 24 ) );   // 24 = три ровных ряда по восемь
	if ( '' === $grid ) {
		return '';
	}
	$out  = waystea_hits_css();
	$out .= '<div class="waystea-hits" style="padding:44px 20px;background:#fdf8f2;"><div style="max-width:1100px;margin:0 auto;">';
	$out .= '<h2 style="text-align:center;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#2c1810;margin:0 0 6px;">Хиты продаж</h2>';
	$out .= '<p style="text-align:center;color:#9e8e7e;font-size:14px;margin:0 0 26px;">Что у нас заказывают чаще всего</p>';
	$out .= $grid;
	$out .= '<div style="text-align:center;margin-top:32px;">';
	$out .= '<a href="' . esc_url( home_url( '/hity-prodazh/' ) ) . '" style="display:inline-block;background:#2c1810;color:#fff;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Все хиты продаж →</a>';
	$out .= '</div></div></div>';
	return $out;
} );

/** [waystea_hits_all] — полный список для страницы /hity-prodazh/. */
add_shortcode( 'waystea_hits_all', function ( $atts ) {
	$atts = shortcode_atts( array( 'limit' => 24 ), $atts );
	return waystea_hits_css() . '<div class="waystea-hits">' . waystea_hits_grid( waystea_hits_ids( (int) $atts['limit'] ) ) . '</div>';
} );

/**
 * Приём рейтинга из кассы: POST /wp-json/waystea/v1/hits с {"ids":[...]}.
 * Только администратор — как у любого служебного маршрута на этом сайте,
 * и в отличие от одноразового сниппета 74, который висел открытым наружу.
 */
add_action( 'rest_api_init', function () {
	register_rest_route( 'waystea/v1', '/hits', array(
		'methods'             => 'POST',
		'permission_callback' => function () { return current_user_can( 'manage_options' ); },
		'callback'            => function ( $req ) {
			$ids = $req->get_param( 'ids' );
			if ( ! is_array( $ids ) ) {
				return new WP_Error( 'bad', 'нужен массив ids', array( 'status' => 400 ) );
			}
			$ids = array_values( array_unique( array_map( 'intval', $ids ) ) );
			update_option( 'waystea_hits_pos', $ids, false );
			delete_transient( 'waystea_hits_rank' );
			return array( 'ok' => true, 'сохранено' => count( $ids ) );
		},
	) );
} );

/** Новый заказ — рейтинг устарел. */
add_action( 'woocommerce_order_status_changed', function () {
	delete_transient( 'waystea_hits_rank' );
} );
