<?php
/**
 * Главная. Порт шаблона MODX «Главная страница»:
 *   [[$head]] [[*content]] [[$map_and_footer]]
 * Слайдер в шапке рисует header.php при виде шапки h1.
 */
get_header();

while ( have_posts() ) :
	the_post();
	the_content();
endwhile;

get_footer();
