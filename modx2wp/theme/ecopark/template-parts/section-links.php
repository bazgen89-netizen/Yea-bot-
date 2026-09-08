<?php
/**
 * Блок из трёх плиток. Порт чанка `links`.
 * Ссылки и картинки были захардкожены в чанке; здесь они собираются
 * по адресам страниц, а картинки лежат в /content/home/links/.
 */
$eco_tiles = array(
	array(
		'class' => 'link l2 anim frombottom p5',
		'uri'   => 'russkaya-banya/',
		'img'   => 'content/home/links/block-1-2.jpg',
		'title' => 'Русские бани <br>на дровах',
		'text'  => 'Что может быть лучше отдыха в бане после трудовых будней? Только отдых в русской бане!',
	),
	array(
		'class' => 'link l3 notp anim frombottom p10',
		'uri'   => 'uslugi/spa/',
		'img'   => 'content/home/links/block-1-3.jpg',
		'title' => 'Различные <br>Спа-уходы',
		'text'  => 'В экопарке особые пилинги, которые Вы запомните навсегда своей неповторимостью и необычайным ароматом.',
	),
	array(
		'class' => 'link l1 anim frombottom',
		'uri'   => 'komfort-otdyh/',
		'img'   => 'content/home/links/block-1-1.jpg',
		'title' => 'Комфортный <br>семейный отдых',
		'text'  => 'В Богослово есть всё для комфортного отдыха. Просторные гостиные, жаркие бани, панорамные веранды, мангальные зоны.',
	),
);
?>
<div class="linksbl">
	<?php foreach ( $eco_tiles as $eco_tile ) : ?>
		<div class="<?php echo esc_attr( $eco_tile['class'] ); ?>">
			<a href="<?php echo esc_url( eco_url( $eco_tile['uri'] ) ); ?>"></a>
			<div class="i" style="background-image:url(<?php echo esc_url( home_url( '/' . $eco_tile['img'] ) ); ?>);"></div>
			<div class="cont">
				<div class="top">
					<div class="ico"></div>
					<p class="h"><?php echo wp_kses( $eco_tile['title'], array( 'br' => array() ) ); ?></p>
				</div>
				<div class="bt">
					<p><?php echo esc_html( $eco_tile['text'] ); ?></p>
					<span class="btn white"><span>Подробнее</span></span>
				</div>
			</div>
		</div>
	<?php endforeach; ?>
</div>
