<?php
/**
 * Запрет кэширования HTML-страниц браузером.
 *
 * После обновления темы браузеры могли показывать устаревшие (пустые из-за
 * прежних ошибок) версии страниц из своего кэша: главную открывали свежей
 * по ссылке с ?v=, а внутренние страницы (Контакты, Коттеджи и т. д.) —
 * из памяти старыми. Отдаём фронтенду заголовки, требующие всегда
 * перепроверять страницу на сервере, чтобы устаревшие копии не показывались.
 * Статику (CSS/JS/картинки) это не трогает — у неё свои версии (?ver=).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'send_headers', 'eco_no_html_cache' );
function eco_no_html_cache() {
	if ( is_admin() ) {
		return;
	}
	// Только для обычных страниц сайта, не для служебных запросов.
	if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) {
		return;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return;
	}
	nocache_headers();
	header( 'Cache-Control: no-cache, no-store, must-revalidate, max-age=0' );
	header( 'Pragma: no-cache' );
}
