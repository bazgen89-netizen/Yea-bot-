<?php
/**
 * Обычная страница. Порт шаблона MODX «Стандартная страница».
 */
get_header();

while ( have_posts() ) :
	the_post();
	eco_the_page_header();
	the_content();
endwhile;

get_footer();
