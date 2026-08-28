<?php
/** Услуга. Порт шаблона MODX «Услуги» — структурно совпадает со стандартной. */
get_header();

while ( have_posts() ) :
	the_post();
	eco_the_page_header();
	the_content();
endwhile;

get_footer();
