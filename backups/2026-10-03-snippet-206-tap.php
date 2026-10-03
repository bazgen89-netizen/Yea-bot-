/**
 * Waystea: размер кнопок на телефоне.
 *
 * Яндекс.Вебмастер держит у сайта метку NOT_MOBILE_FRIENDLY
 * (раздел «Диагностика», состояние PRESENT с 22.09.2026). Разбор
 * в браузере на окне 390×844 показал, где именно нарушен норматив
 * «кнопка не меньше 40×40»:
 *
 *   • «В корзину» в каталоге — 152×29 (16 кнопок на странице);
 *   • ссылки пагинации — 25×32 и 32×32;
 *   • иконки соцсетей — 36×36.
 *
 * Горизонтальной прокрутки нет, viewport задан правильно, шрифт
 * в карточках нормальный — то есть остаются именно размеры нажатия.
 *
 * Правка — только отступы и минимальная высота, и только на экранах
 * до 1024 px. Цвета, шрифты и расположение не трогаются.
 *
 * Откат: выключить сниппет.
 */
add_action( 'wp_head', function () {
	if ( is_admin() ) {
		return;
	}
	?>
<style id="waystea-tap-targets">
@media (max-width: 1024px) {
	.woocommerce a.button.product_type_simple,
	.woocommerce a.button.product_type_variable,
	.woocommerce ul.products li.product a.button,
	.woocommerce ul.products li.product .button {
		min-height: 44px;
		padding-top: 11px;
		padding-bottom: 11px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1.2;
	}
	.woocommerce nav.woocommerce-pagination a.page-numbers,
	.woocommerce nav.woocommerce-pagination span.page-numbers,
	.woocommerce-pagination a.page-numbers,
	.woocommerce-pagination span.page-numbers {
		min-width: 42px;
		min-height: 42px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin: 3px;
	}
	.elementor-social-icon {
		min-width: 42px;
		min-height: 42px;
	}
	/* Оглавление статей: ссылки были высотой 15-16 px */
	.ez-toc-list a.ez-toc-link {
		display: inline-block;
		padding: 11px 0;
		line-height: 1.35;
	}
}
</style>
	<?php
}, 99 );
