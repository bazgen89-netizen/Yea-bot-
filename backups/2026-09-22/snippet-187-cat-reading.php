/* Перелинковка категорий на блог.
   Замер 22.09.2026: из 15 категорий ссылки на статьи были только
   у «Красного чая» — две. У остальных четырнадцати ноль.
   При этом блог собирает 68 % всех показов сайта из Google
   (6334 из 9268 за месяц), а карточки товара — 17 %. Связать
   каталог с блогом дёшево и полезно в обе стороны: покупатель
   из категории попадает в разбор, робот получает путь обхода.

   Блок выводится после списка товаров. Важно: на архивах товаров
   woocommerce_after_shop_loop срабатывает ДВАЖДЫ — защита флагом. */
add_action( 'woocommerce_after_shop_loop', 'waystea_category_reading', 30 );
function waystea_category_reading() {
    static $done = false;
    if ( $done || ! is_product_taxonomy() ) {
        return;
    }
    $term = get_queried_object();
    if ( ! $term || empty( $term->slug ) ) {
        return;
    }

    $map = array(
        'puer-shu' => array(
            array( 'Шу пуэр: руководство по ферментированному чаю', '/shu-puer/' ),
            array( 'Как выбрать пуэр: на что смотреть при покупке', '/kak-vybrat-puer/' ),
            array( 'Польза пуэра: что говорит наука', '/polza-puera/' ),
        ),
        'puer-shen' => array(
            array( 'Шэн пуэр: живой чай, который стареет как вино', '/shen-puer/' ),
            array( 'Пуэр: виды шэн и шу, как выбрать и заварить', '/puer-chto-eto-vidy-shen-shu/' ),
            array( 'Юньнань: провинция, откуда родился пуэр', '/chaj-yunnan/' ),
        ),
        'krasnyj-chaj' => array(
            array( 'Красный чай (Хун Ча): история, вкус, сорта', '/krasnyj-chaj/' ),
            array( 'История красного чая: от Фуцзяни до дипломатии', '/krasnyj-kitajskij-chaj/' ),
        ),
        'zelyonyj-chaj' => array(
            array( 'Зелёный чай: виды, польза и как правильно заваривать', '/zelenyj-chaj-vidy-polza-kak-zavaryat/' ),
            array( 'Температура воды для чая: почему это важнее, чем кажется', '/temperatura-vody-dlya-chaya/' ),
        ),
        'belyj-chaj' => array(
            array( 'Белый чай: Бай Хао Инь Чжэнь и Бай Му Дань', '/belyj-chaj/' ),
            array( 'Польза белого чая: антиоксиданты, кожа и не только', '/polza-belogo-chaya/' ),
        ),
        'tyomnyj-ulun' => array(
            array( 'Тёмный улун: Да Хун Пао, Дань Цун и Те Ло Хань', '/tyomnyj-ulun-da-hun-pao/' ),
            array( 'Улун: виды, вкус, как выбрать и заварить', '/ulong-vidy-vkus-kak-vybrat/' ),
        ),
        'svetlyj-ulun' => array(
            array( 'Светлый улун: Тегуаньинь, Алишань и другие', '/svetlyj-ulon-tajvan-teguan-in-alishan/' ),
            array( 'Улун: виды, вкус, как выбрать и заварить', '/ulong-vidy-vkus-kak-vybrat/' ),
        ),
        'tajvanskij-chaj' => array(
            array( 'Тайваньский чай: остров с лучшими улунами в мире', '/tajvanskij-chaj/' ),
            array( 'Светлый улун: Тегуаньинь, Алишань и другие', '/svetlyj-ulon-tajvan-teguan-in-alishan/' ),
        ),
        'gaba' => array(
            array( 'ГАБА чай: что это и почему его называют антистрессовым', '/gaba-chaj/' ),
            array( 'Тайваньский чай: остров с лучшими улунами в мире', '/tajvanskij-chaj/' ),
        ),
        'xej-cha' => array(
            array( 'Чай Лю Бао: предшественник пуэра', '/chaj-lyu-bao-vo-vladimire/' ),
            array( 'Прессованный или рассыпной чай: что купить', '/pressovannyj-chaj/' ),
        ),
        'matcha' => array(
            array( 'Что такое матча: виды, польза, как заваривать', '/chto-takoe-matcha/' ),
            array( 'Матча: японская или китайская — в чём разница', '/matcha-chaj/' ),
        ),
        'mate' => array(
            array( 'Температура воды для чая: почему это важнее, чем кажется', '/temperatura-vody-dlya-chaya/' ),
            array( 'Количество заварки: сколько граммов на чашку', '/skolko-chaya-na-chashku/' ),
        ),
        'dobavki-travy-sbory' => array(
            array( 'Саган-дайля: свойства и как заваривать', '/sagan-dajlya-trava/' ),
            array( 'В чём хранить чай', '/kak-hranit-chaj/' ),
        ),
        'posuda' => array(
            array( 'Из чего пить чай: пиалы', '/pialy-dlya-chaya/' ),
            array( 'Гайвань: что это такое и как правильно заваривать', '/gajvan-chto-eto-takoe-i-kak-pravilno-zavarivat-chaj/' ),
            array( 'В чём заваривать чай: выбор чайника', '/chajnik-dlya-zavarki-vybor/' ),
            array( 'Гунфу ча дома: церемония без мастера', '/gunfu-cha-doma/' ),
        ),
        'mainmain' => array(
            array( 'Виды китайского чая: полный гид от пуэра до белого', '/vidy-kitayskogo-chaya/' ),
            array( '6 категорий китайского чая и феномен Camellia sinensis', '/camellia_sinensis_kust_ili_derevo/' ),
            array( 'Названия китайского чая: как их читать', '/nazvaniya-kitajskogo-chaya-perevod/' ),
        ),
    );

    if ( empty( $map[ $term->slug ] ) ) {
        return;
    }
    $done = true;

    // у посуды и общего каталога заголовок про чай был бы неуместен
    $heading = in_array( $term->slug, array( 'posuda', 'mainmain' ), true )
        ? 'Что почитать'
        : 'Что почитать об этом чае';
    echo '<section class="waystea-cat-reading"><h2>' . esc_html( $heading ) . '</h2><ul>';
    foreach ( $map[ $term->slug ] as $a ) {
        printf( '<li><a href="%s">%s</a></li>',
            esc_url( home_url( $a[1] ) ), esc_html( $a[0] ) );
    }
    echo '</ul></section>';
}

add_action( 'wp_head', function () {
    if ( ! is_product_taxonomy() ) {
        return;
    }
    echo '<style>.waystea-cat-reading{margin:2.5rem 0 1rem;padding:1.25rem 1.5rem;'
       . 'border:1px solid #e3e3e3;border-radius:10px;background:#fbfbfa}'
       . '.waystea-cat-reading h2{font-size:1.15rem;margin:0 0 .6rem}'
       . '.waystea-cat-reading ul{margin:0;padding-left:1.1rem}'
       . '.waystea-cat-reading li{margin:.3rem 0}</style>';
}, 20 );
