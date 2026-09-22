/* Тема Elementor не выводит описание категории товаров на архиве —
   этот сниппет возвращает его вручную.

   ПРАВКА 22.09.2026: описание выводилось ДВАЖДЫ на каждой странице
   категории. Причина — `woocommerce_before_shop_loop` на архивах товаров
   срабатывает два раза, а защиты не было. Проверено: с выключенным
   сниппетом описания нет вовсе (тема его по-прежнему съедает), с включённым
   без флага — две копии подряд.

   Для сайта, который мы лечим от дублирующегося текста, выводить
   собственное описание категории дважды — прямое вредительство. */
add_action( "woocommerce_before_shop_loop", "waystea_reAdd_archive_description", 4 );
function waystea_reAdd_archive_description() {
    static $done = false;
    if ( $done ) {
        return;
    }
    if ( is_product_taxonomy() && function_exists( "woocommerce_taxonomy_archive_description" ) ) {
        $done = true;
        remove_action( "woocommerce_archive_description", "woocommerce_taxonomy_archive_description", 10 );
        woocommerce_taxonomy_archive_description();
    }
}
