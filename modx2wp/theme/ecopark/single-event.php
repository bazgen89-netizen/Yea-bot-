<?php
/** Публикация. Порт шаблона MODX «Страница событий». */
get_header();

while ( have_posts() ) :
	the_post();
	eco_the_page_header();
	the_content();
endwhile;

get_footer();
