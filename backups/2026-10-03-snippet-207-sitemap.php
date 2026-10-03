/**
 * Waystea: служебные страницы вон из карты сайта и из индекса.
 *
 * Яндекс.Вебмастер держал метку DOCUMENTS_MISSING_DESCRIPTION
 * («Диагностика», PRESENT с 30.09.2026). Проверка всех 119 адресов
 * карты сайта нашла ровно три страницы без описания — и все три
 * служебные: /cart/, /lichnyj-kabinet/, /evercompare/.
 *
 * Описания им не нужны: это не страницы для поиска. Корзина и чекаут
 * уже закрыты в robots.txt, но при этом **лежали в карте сайта** —
 * противоречие, из-за которого робот ходил туда и считал их
 * неоформленными.
 *
 * Закрываются: корзина, оформление заказа, личный кабинет, сравнение
 * товаров, страница «спасибо за заказ». Правовые страницы (оферта,
 * возврат) и «Хиты продаж» остаются — они людям нужны.
 *
 * Откат: выключить сниппет.
 */
function waystea_service_pages() {
	return array( 10, 11, 15230, 12097, 11873 );
}

// Из карты сайта
add_filter( 'wpseo_sitemap_exclude_post_type', '__return_false' );
add_filter( 'wpseo_exclude_from_sitemap_by_post_ids', function ( $ids ) {
	return array_values( array_unique( array_merge( (array) $ids, waystea_service_pages() ) ) );
} );

// И из индекса: noindex, follow
add_filter( 'wpseo_robots', function ( $robots ) {
	if ( is_page( waystea_service_pages() ) ) {
		return 'noindex, follow';
	}
	return $robots;
}, 20 );
