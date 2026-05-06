var Currency = (function () {
    function Currency(pennies) {
        this.pennies = Math.floor(pennies);
    }
    Currency.prototype.toJSON = function () {
        return this.pennies;
    };
    Currency.fromString = function (s) {
        var numbers = s.replace(/[$,]/g, "");
        var matches = numbers.match(/(\d+)[.](\d{1,2})/);
        if (!matches) {
            matches = numbers.match(/^(\d*)[.]?(\d*)$/);
            if (!matches) {
                throw ("Invalid currency amount: " + s);
            }
            if (matches[1] == "") {
                matches[1] = "0";
            }
            if (matches[2] == "") {
                matches[2] = "0";
            }
        }
        var dollars = parseInt(matches[1], 10);
        var cents = parseInt(matches[2], 10);
        if (matches[2].length == 1)
            cents *= 10;
        return new Currency(dollars * 100 + cents);
    };
    Currency.fromFloat = function (x) {
        var pennies = Math.floor(x + 0.5);
        return new Currency(pennies);
    };
    Currency.maybeFromString = function (s) {
        var price;
        try {
            price = Currency.fromString(s);
        }
        catch (_) {
            price = undefined;
        }
        return price;
    };
    Currency.prototype.plus = function (x) {
        return new Currency(this.pennies + x.pennies);
    };
    Currency.prototype.minus = function (x) {
        return new Currency(this.pennies - x.pennies);
    };
    Currency.prototype.multiply = function (m) {
        var n = Math.floor(this.pennies * m + 0.5);
        return new Currency(n);
    };
    Currency.prototype.toString = function () {
        var str = '' + this.pennies;
        var dollars = '0';
        var cents = '00';
        if (str.length <= 1) {
            cents = '0' + str;
        }
        else if (str.length <= 2) {
            cents = str;
        }
        else {
            var matches = str.match(/^(\d+)(\d{2})$/);
            dollars = matches[1];
            cents = matches[2];
        }
        return '$' + dollars + '.' + cents;
    };
    return Currency;
}());
var StripePublicKey = "pk_live_3FQ4iBRUATX8fiumT0tpFNPQ";
function implement_typical_shipping_button() {
    $('#adjust-for-shipping').click(adjust_for_shipping);
}
function adjust_for_shipping(e) {
    if ($(this).is(':checked')) {
        add_shipping_costs();
        analytics_track_event('Tools', 'Price Change', 'Add Shipping');
    }
    else {
        restore_original_prices();
        analytics_track_event('Tools', 'Price Change', 'Remove Shipping');
    }
}
function add_shipping_costs() {
    $('.used-prices tbody tr').each(function (i, elem) {
        var tr = $(elem);
        var affiliate = affiliate_from_name(tr.data('source-name'));
        var shipping = typical_shipping_cost(affiliate, VGPC.product.is_system);
        tr.find('td.price').each(function (i, elem) {
            transform_price($(elem), function (now, original) {
                return [now.plus(shipping), now];
            });
        });
    });
    var shipping = new Currency(VGPC.product.is_system ? 1500 : 400);
    var our_prices = $('#used_price .price').add('#new_price .price').add('#complete_price .price');
    our_prices.each(function (i, elem) {
        transform_price($(elem), function (now, original) {
            return [now.plus(shipping), now];
        });
    });
    our_prices.add('.used-prices tbody td.price').effect('highlight', {}, 750);
}
function restore_original_prices() {
    var id = function (i, elem) {
        transform_price($(elem), function (now, original) {
            return [original, null];
        });
    };
    var price_tds = $('.used-prices tbody td.price');
    price_tds.each(id);
    var our_prices = $('#used_price .price').add('#new_price .price').add('#complete_price .price');
    our_prices.each(id);
    our_prices.add(price_tds).effect('highlight', {}, 750);
}
function transform_price(node, fn) {
    var price = Currency.maybeFromString(node.text());
    if (price === undefined)
        return;
    var original = Currency.maybeFromString(node.data('original-price'));
    var prices = fn(price, original);
    if (prices[0] != null) {
        node.text(prices[0].toString());
    }
    if (original === undefined && prices[1] != null) {
        node.data('original-price', prices[1].toString());
    }
}
function typical_shipping_cost(affiliate, is_system) {
    var amt;
    if (is_system) {
        amt = affiliate == Affiliate.Amazon ? '$3.99'
            : affiliate == Affiliate.Pcm ? '$10.00'
                : '$9.00';
        ;
    }
    else {
        amt = affiliate == Affiliate.Amazon ? '$3.99'
            : affiliate == Affiliate.GameStop ? '$3.00'
                : affiliate == Affiliate.Pcm ? '$3.00'
                    : '$3.00';
        ;
    }
    return Currency.fromString(amt);
}
function display_admin_charts() {
    if (window.location.pathname != "/admin/dash") {
        return;
    }
    var commonChartOptions = {
        chart: {
            type: 'line'
        },
        title: {
            align: 'left'
        },
        xAxis: {
            type: 'datetime',
            tickmarkPlacement: 'on',
            dateTimeLabelFormats: {
                day: '%e-%b'
            },
            categories: HS['chart_dates']
        },
    };
    var activeOffers = {
        chart: {
            renderTo: 'chart-active-offers'
        },
        title: {
            text: HS['activeOffersTitle'],
        },
        series: [{
                data: HS['activeOffersData'],
            }],
        legend: {
            enabled: false,
        },
    };
    var offersBought = {
        chart: {
            type: 'column',
            renderTo: 'chart-offers-bought'
        },
        title: {
            text: HS['offersBoughtTitle'],
        },
        series: [{
                name: 'All Offers',
                data: HS['boughtAllOffersData'],
            }, {
                name: 'Console',
                data: HS['boughtConsoleData'],
            }, {
                name: 'Product',
                data: HS['boughtProductData'],
            }, {
                name: 'Snipe',
                data: HS['boughtSnipeData'],
            }, {
                name: 'Recommend',
                data: HS['boughtRecommendData'],
            }, {
                name: 'Wishlist',
                data: HS['boughtWishlistData'],
            }, {
                name: 'Other',
                data: HS['boughtOtherData'],
            }],
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        legend: {
            enabled: true,
        },
    };
    var offersCreated = {
        chart: {
            renderTo: 'chart-offers-created'
        },
        title: {
            text: HS['offersCreatedTitle'],
        },
        series: [{
                data: HS['offersCreatedData'],
            }],
        legend: {
            enabled: false,
        },
    };
    var ebayNewListings = {
        chart: {
            type: 'column',
            renderTo: 'chart-ebay-new-listings'
        },
        title: {
            text: HS['ebayNewListingsTitle'],
        },
        series: [{
                name: 'Total',
                data: HS['ebayNewListingsData'],
            }, {
                name: 'Sniper',
                data: HS['ebayNewListingsSniperData'],
            }, {
                name: 'FindingAPI',
                data: HS['ebayNewListingsFindingApiData'],
            }, {
                name: 'Scraper',
                data: HS['ebayNewListingsScraperData'],
            }],
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        legend: {
            enabled: true,
        },
    };
    var ebaySales = {
        chart: {
            type: 'column',
            renderTo: 'chart-ebay-sales'
        },
        title: {
            text: HS['ebaySalesTitle'],
        },
        series: [{
                name: 'Sold',
                data: HS['ebaySoldData'],
            }, {
                name: 'Not Sold',
                data: HS['ebayNotSoldData'],
            }],
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        legend: {
            enabled: true,
        },
    };
    var ebayCategory = {
        chart: {
            type: 'column',
            renderTo: 'chart-ebay-category'
        },
        title: {
            text: HS['ebayCategoryTitle'],
        },
        series: [{
                name: 'Games',
                data: HS['ebayCategoryVideoGamesData'],
            }, {
                name: 'Baseball',
                data: HS['ebayCategoryBaseballCardData'],
                visible: false,
            }, {
                name: 'Basketball',
                data: HS['ebayCategoryBasketballCardData'],
                visible: false,
            }, {
                name: 'Football',
                data: HS['ebayCategoryFootballCardData'],
                visible: false,
            }, {
                name: 'Hockey',
                data: HS['ebayCategoryHockeyCardData'],
                visible: false,
            }, {
                name: 'Soccer',
                data: HS['ebayCategorySoccerCardData'],
                visible: false,
            }, {
                name: 'Pokemon',
                data: HS['ebayCategoryPokemonCardData'],
                visible: false,
            }, {
                name: 'Magic',
                data: HS['ebayCategoryMagicCardData'],
                visible: false,
            }, {
                name: 'YuGiOh',
                data: HS['ebayCategoryYugiohCardData'],
                visible: false,
            }, {
                name: 'GPK',
                data: HS['ebayCategoryGPKCardData'],
                visible: false,
            }, {
                name: 'Comics',
                data: HS['ebayCategoryComicBookData'],
                visible: false,
            }, {
                name: 'Lego',
                data: HS['ebayCategoryLegoSetData'],
                visible: false,
            }, {
                name: 'Funko',
                data: HS['ebayCategoryFunkoPopsData'],
                visible: false,
            }, {
                name: 'Coins',
                data: HS['ebayCategoryCoinData'],
                visible: false,
            }],
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        legend: {
            enabled: true,
        },
    };
    var ebaySoldByCategory = {
        chart: {
            type: 'column',
            renderTo: 'chart-ebay-sold-by-category'
        },
        title: {
            text: HS['ebaySoldByCategoryTitle'],
        },
        series: [{
                name: 'Games',
                data: HS['ebaySoldVideoGamesData'],
            }, {
                name: 'Baseball',
                data: HS['ebaySoldBaseballCardData'],
                visible: false,
            }, {
                name: 'Basketball',
                data: HS['ebaySoldBasketballCardData'],
                visible: false,
            }, {
                name: 'Football',
                data: HS['ebaySoldFootballCardData'],
                visible: false,
            }, {
                name: 'Hockey',
                data: HS['ebaySoldHockeyCardData'],
                visible: false,
            }, {
                name: 'Soccer',
                data: HS['ebaySoldSoccerCardData'],
                visible: false,
            }, {
                name: 'Pokemon',
                data: HS['ebaySoldPokemonCardData'],
                visible: false,
            }, {
                name: 'Magic',
                data: HS['ebaySoldMagicCardData'],
                visible: false,
            }, {
                name: 'YuGiOh',
                data: HS['ebaySoldYugiohCardData'],
                visible: false,
            }, {
                name: 'GPK',
                data: HS['ebaySoldGPKCardData'],
                visible: false,
            }, {
                name: 'Comics',
                data: HS['ebaySoldComicBookData'],
                visible: false,
            }, {
                name: 'Lego',
                data: HS['ebaySoldLegoSetData'],
                visible: false,
            }, {
                name: 'Funko',
                data: HS['ebaySoldFunkoPopsData'],
                visible: false,
            }, {
                name: 'Coins',
                data: HS['ebaySoldCoinData'],
                visible: false,
            }],
        plotOptions: {
            column: {
                stacking: 'normal',
            }
        },
        legend: {
            enabled: true,
        },
    };
    var ebayInferRatioByCategory = {
        chart: {
            renderTo: 'chart-ebay-infer-ratio'
        },
        title: {
            text: HS['ebayInferRatioByCategoryTitle'],
        },
        series: [{
                name: 'Games',
                data: HS['ebayInferRatioVideoGamesData'],
            }, {
                name: 'Baseball',
                data: HS['ebayInferRatioBaseballCardData'],
                visible: false,
            }, {
                name: 'Basketball',
                data: HS['ebayInferRatioBasketballCardData'],
                visible: false,
            }, {
                name: 'Football',
                data: HS['ebayInferRatioFootballCardData'],
                visible: false,
            }, {
                name: 'Hockey',
                data: HS['ebayInferRatioHockeyCardData'],
                visible: false,
            }, {
                name: 'Soccer',
                data: HS['ebayInferRatioSoccerCardData'],
                visible: false,
            }, {
                name: 'Pokemon',
                data: HS['ebayInferRatioPokemonCardData'],
            }, {
                name: 'Magic',
                data: HS['ebayInferRatioMagicCardData'],
                visible: false,
            }, {
                name: 'YuGiOh',
                data: HS['ebayInferRatioYugiohCardData'],
                visible: false,
            }, {
                name: 'GPK',
                data: HS['ebayInferRatioGPKCardData'],
                visible: false,
            }, {
                name: 'Comics',
                data: HS['ebayInferRatioComicBookData'],
                visible: false,
            }, {
                name: 'Lego',
                data: HS['ebayInferRatioLegoSetData'],
                visible: false,
            }, {
                name: 'Funko',
                data: HS['ebayInferRatioFunkoPopsData'],
                visible: false,
            }, {
                name: 'Coins',
                data: HS['ebayInferRatioCoinData'],
                visible: false,
            }],
        legend: {
            enabled: true,
        },
    };
    var ebayNotSold = {
        chart: {
            renderTo: 'chart-ebay-not-sold'
        },
        title: {
            text: HS['ebayNotEndedTitle'],
        },
        series: [{
                data: HS['ebayNotEndedData'],
            }],
        legend: {
            enabled: false,
        },
    };
    var charts = [
        activeOffers,
        offersBought,
        offersCreated,
        ebayNewListings,
        ebaySales,
        ebayCategory,
        ebayNotSold,
        ebaySoldByCategory,
        ebayInferRatioByCategory,
    ];
    $.each(charts, function (i, val) {
        $.extend(commonChartOptions, val);
        new Highcharts.Chart(commonChartOptions);
    });
}
var Affiliate;
(function (Affiliate) {
    Affiliate[Affiliate["Amazon"] = 0] = "Amazon";
    Affiliate[Affiliate["Ebay"] = 1] = "Ebay";
    Affiliate[Affiliate["GameStop"] = 2] = "GameStop";
    Affiliate[Affiliate["Pcm"] = 3] = "Pcm";
    Affiliate[Affiliate["TcgPlayer"] = 4] = "TcgPlayer";
})(Affiliate || (Affiliate = {}));
function affiliate_link(ad, product_id, item_id) {
    var affiliate = infer_affiliate(item_id);
    if (affiliate == Affiliate.Pcm) {
        return "/offer/" + item_id + '?f=snipe';
    }
    var code = lookup_affiliate_code(affiliate, ad);
    return apply_affiliate_link_template(affiliate, code, product_id, item_id);
}
function affiliate_impression_link(affiliate, ad, product_id) {
    var code = lookup_affiliate_code(affiliate, ad);
    return apply_affiliate_impression_template(affiliate, code, product_id);
}
function infer_affiliate(item_id) {
    if (item_id.length <= 15) {
        return Affiliate.Ebay;
    }
    return Affiliate.Pcm;
}
function lookup_affiliate_code(affiliate, ad) {
    if (affiliate == Affiliate.Ebay) {
        switch (ad) {
            case 0:
                return '5336510469';
            case 1:
                return '5336817478';
            case 2:
                return '5337429266';
            case 3:
                return '5338806958';
        }
        throw "Unhandled location '" + ad + "'";
    }
    throw "Unhandled affiliate '" + affiliate + "'";
}
function apply_affiliate_link_template(affiliate, code, product_id, item_id) {
    if (affiliate == Affiliate.Ebay) {
        return "https://www.ebay.com/itm/" + item_id + "?"
            + "nordt=true&rt=nc" + "&"
            + "mkevt=1&mkcid=1" + "&"
            + "mkrid=711-53200-19255-0" + "&"
            + "campid=" + code + "&"
            + "toolid=10001" + "&"
            + "customid=G" + product_id + "&";
    }
    throw "Unhandled affiliate '" + affiliate + "'";
}
function apply_affiliate_impression_template(affiliate, code, product_id) {
    if (affiliate == Affiliate.Ebay) {
        return "https://rover.ebay.com/roverimp/1/711-53200-19255-0/1?"
            + "ff3=2&"
            + "toolid=10001&"
            + "campid=" + code + "&"
            + "customid=G" + product_id;
    }
    throw "Unknown impression affiliate '" + affiliate + "'";
}
function ad_unit_value(affiliate, ad) {
    switch (ad) {
        case 1:
            switch (affiliate) {
                case Affiliate.Amazon:
                    return 47;
                case Affiliate.Ebay:
                    return 67;
                case Affiliate.TcgPlayer:
                    return 0;
            }
    }
    console.log("Unknown ad unit: " + affiliate + " and " + ad);
    return 0;
}
function affiliate_from_name(name) {
    switch (name.toLowerCase()) {
        case "amazon":
            return Affiliate.Amazon;
        case "ebay":
            return Affiliate.Ebay;
        case "gamestop":
            return Affiliate.GameStop;
        case "pcm":
        case "pricecharting":
            return Affiliate.Pcm;
        case "tcgplayer":
            return Affiliate.TcgPlayer;
    }
    throw ("Can't parse affiliate name: " + name);
}
function implement_card_chosen() {
    var img = $('#image');
    img.change(function (e) {
        var input = e.target;
        var files = img.prop("files");
        if (files.length > 0) {
            show_image_thumbnail(input, files[0], 1);
        }
    });
    img.show();
}
function implement_card_centering_resize() {
    $("form#js-submit").submit(function (e) {
        e.preventDefault();
        $("#js-processing").show();
        $("#js-submit").hide();
        var files = $("#image").prop("files");
        if (files.length > 0) {
            resize_image_blob(files[0], function (image) {
                var fd = new FormData();
                fd.append("image", image);
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "/api/card-centering-calculator");
                xhr.onload = function () {
                    var response = JSON.parse(xhr.response);
                    $("#js-grade").text(response.grade);
                    $("#js-gradefraction").text(response.gradefraction);
                    $("#js-ratio").text(response.ratio.toFixed(2));
                    $("#js-xzero").text(response.xzero);
                    $("#js-xmax").text(response.xmax);
                    $("#js-xratio").text(response.xratio.toFixed(2));
                    $("#js-yzero").text(response.yzero);
                    $("#js-ymax").text(response.ymax);
                    $("#js-yratio").text(response.yratio.toFixed(2));
                    $("#js-new-image img").remove();
                    var newImageHtml = '<img id="marked-image" src="data:image/jpg;base64,' + response.newimage + '" />';
                    $("#js-new-image").prepend(newImageHtml);
                    $(".js-initial-tips").hide();
                    $(".js-post-results").show();
                    $("#js-processing").hide();
                    $(".thumbnail").hide();
                    $("#js-submit").show();
                    $('html, body').animate({
                        scrollTop: $('h1').offset().top
                    }, 300);
                    gtag('config', ga4_tag_id, { page_location: '/card-centering-calculator?submitted=true' });
                };
                xhr.send(fd);
            }, 800, 800);
        }
    });
}
function implement_console_selection_widget(options) {
    var chosen = $('.js-chosen-consoles');
    if (!options.on_change)
        options.on_change = function () { };
    if (!options.maximum_consoles_to_render)
        options.maximum_consoles_to_render = 3;
    if (!options.display_method)
        options.display_method = 0;
    $('#choose-consoles').data('options', options);
    $('#choose-consoles h2').click(toggle_console_groups_visibility);
    var all = $('#console-groups ul li');
    $('#select-all').click(function (e) {
        all.addClass('selected');
        chosen.text('All');
        widget_options()["on_change"]();
        hesitate_to_store_selected_consoles();
        return !$(e.target).is('a');
    });
    $('#select-none').click(function (e) {
        all.removeClass('selected');
        chosen.text('No');
        widget_options()["on_change"]();
        hesitate_to_store_selected_consoles();
        return !$(e.target).is('a');
    });
    select_previously_selected_consoles();
    var group_name = $('#console-groups > li span');
    support_hovered(group_name);
    group_name.click(function (e) {
        var li = $(this).parent('li');
        var selected = li.find('li.selected');
        if (selected.length > 0) {
            selected.removeClass('selected');
        }
        else {
            li.find('li').addClass('selected');
        }
        update_chosen_text(chosen);
        widget_options()["on_change"]();
    });
    var console_lis = $('#console-groups ul li');
    support_hovered(console_lis);
    console_lis.click(function (e) {
        e.stopPropagation();
        $(this).toggleClass('selected');
        update_chosen_text(chosen);
        widget_options()["on_change"]();
    });
    if (options.display_method == 1) {
        toggle_console_groups_visibility();
        $('.js-consoles-trigger').click(function (e) {
            e.preventDefault();
            $('.js-consoles-widget').dialog({
                "modal": true,
                "width": "80%",
                "buttons": [
                    {
                        "text": "OK",
                        "click": function () {
                            $(this).dialog("close");
                        }
                    }
                ]
            });
        });
    }
}
function toggle_console_groups_visibility() {
    $('#choose-consoles > p, #choose-consoles > ul').toggleClass('hidden');
    if ($('#choose-consoles > p').hasClass('hidden')) {
        $('#pricing-cart-page').css('min-height', '');
    }
    else {
        $('#pricing-cart-page').css('min-height', '1200px');
    }
}
function widget_options() {
    var options = $('#choose-consoles').data('options');
    return options;
}
function wants_retain_selection() {
    return widget_options()["retain_selected_consoles"];
}
function select_previously_selected_consoles() {
    if (!wants_retain_selection())
        return;
    var consoles = preference_get('CartConsoles');
    select_consoles(consoles);
}
function select_consoles(consoles) {
    if (consoles == undefined || consoles == null) {
        $('#select-all').click();
        return;
    }
    $('#select-none').click();
    var ids = consoles.split(',');
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        $('#console_' + id).addClass('selected');
    }
    var chosen = $('.js-chosen-consoles');
    update_chosen_text(chosen);
}
function update_chosen_text(chosen) {
    var selected = $('#console-groups li.selected');
    var text = 'All';
    var maximum_consoles = widget_options()["maximum_consoles_to_render"];
    if (selected.length == 0) {
        text = 'No';
    }
    else {
        var possible = $('#console-groups li ul li');
        if (selected.length != possible.length) {
            var other_count = 0;
            if (selected.length > maximum_consoles) {
                other_count = selected.length - (maximum_consoles - 1);
                selected = selected.slice(0, maximum_consoles - 1);
            }
            var names = [];
            selected.each(function () {
                names.push($(this).find('.js-console-nick').text());
            });
            if (other_count > 0) {
                names.push('and ' + other_count + ' more');
            }
            text = names.join(', ');
        }
    }
    chosen.text(text);
    hesitate_to_store_selected_consoles();
}
var storing_console_in_prefs_timer;
function hesitate_to_store_selected_consoles() {
    if (!wants_retain_selection())
        return;
    clearTimeout(storing_console_in_prefs_timer);
    storing_console_in_prefs_timer = window.setTimeout(function () {
        var consoles = get_selected_console_ids().join(',');
        preference_set('CartConsoles', consoles);
    }, 1000);
}
function get_selected_console_ids() {
    var ids = [];
    $('#console-groups li.selected').each(function () {
        var matches = $(this).attr('id').match(/^console_(\d+)/);
        ids.push(matches[1]);
    });
    return ids;
}
function convert_dashboard_price_data() {
    if (!CollectionDash)
        return;
    ['valuableGroupsValues'].forEach(function (c) {
        if (!CollectionDash[c])
            return;
        CollectionDash[c].forEach(function (p, i) {
            this[i] = p / 100;
        }, CollectionDash[c]);
    });
    ['valuableCategoriesValues'].forEach(function (c) {
        if (!CollectionDash[c])
            return;
        CollectionDash[c].forEach(function (p, i) {
            this[i] = p / 100;
        }, CollectionDash[c]);
    });
    ['valuableFoldersValues'].forEach(function (c) {
        if (!CollectionDash[c])
            return;
        CollectionDash[c].forEach(function (p, i) {
            this[i] = p / 100;
        }, CollectionDash[c]);
    });
    display_collection_dash_charts();
}
function display_collection_dash_charts() {
    if (window.location.pathname != "/collection-dash") {
        return;
    }
    var commonChartOptions = {
        title: {
            align: 'left'
        },
    };
    var valuableGroups = {
        chart: {
            type: 'column',
            renderTo: 'chart-valuable-groups'
        },
        tooltip: {
            shared: true,
            valueDecimals: 2,
        },
        title: {
            text: '',
        },
        xAxis: {
            categories: CollectionDash['valuableGroupsNames'],
            labels: {
                enabled: false
            }
        },
        yAxis: {
            title: false,
            labels: {
                format: '${value}',
            },
        },
        series: [{
                data: CollectionDash['valuableGroupsValues'],
                tooltip: {
                    valuePrefix: "$",
                },
            }],
        legend: {
            enabled: false,
        },
    };
    var valuableCategories = {
        chart: {
            type: 'column',
            renderTo: 'chart-valuable-categories'
        },
        tooltip: {
            shared: true,
            valueDecimals: 2,
        },
        title: {
            text: '',
        },
        xAxis: {
            categories: CollectionDash['valuableCategoriesNames'],
            labels: {
                enabled: false
            }
        },
        yAxis: {
            title: false,
            labels: {
                format: '${value}',
            },
        },
        series: [{
                data: CollectionDash['valuableCategoriesValues'],
                tooltip: {
                    valuePrefix: "$",
                },
            }],
        legend: {
            enabled: false,
        },
    };
    var valuableFolders = {
        chart: {
            type: 'column',
            renderTo: 'chart-valuable-folders'
        },
        tooltip: {
            shared: true,
            valueDecimals: 2,
        },
        title: {
            text: '',
        },
        xAxis: {
            categories: CollectionDash['valuableFoldersNames'],
            labels: {
                enabled: false
            }
        },
        yAxis: {
            title: false,
            labels: {
                format: '${value}',
            },
        },
        series: [{
                data: CollectionDash['valuableFoldersValues'],
                tooltip: {
                    valuePrefix: "$",
                },
            }],
        legend: {
            enabled: false,
        },
    };
    var charts = [
        valuableGroups,
        valuableCategories,
        valuableFolders,
    ];
    $.each(charts, function (i, val) {
        $.extend(commonChartOptions, val);
        new Highcharts.Chart(commonChartOptions);
    });
}
function implement_collection_text_importer() {
    if ($('#processing').length) {
        setTimeout(function () {
            window.location.href = window.location.href;
        }, 3000);
    }
}
function implement_full_details_toggle() {
    $('#more_details').click(function (e) {
        $('#full_details').toggle();
        e.preventDefault();
    });
}
function implement_end_offer() {
    $('#active').on('click', '.js-remove-offer', function (e) {
        e.preventDefault();
        var link = $(e.target);
        var li = link.closest('li');
        li.html("<a href='#' class='js-confirm-remove-offer' title='Confirm removal'>CONFIRM</a>");
    });
}
function implement_confirm_end_offer() {
    $('#active').on('click', '.js-confirm-remove-offer', function (e) {
        e.preventDefault();
        var link = $(e.target);
        var tr = link.closest('tr');
        var offer = tr.data('offer-id');
        if (offer === null) {
            return;
        }
        if (VGPC.user_id === "") {
            alert("You must be logged in to remove an item from a collection");
            return false;
        }
        $.post("/api/offer-end", { 'offer-id': offer });
        tr.toggle();
        $("#gap-" + offer).toggle();
        gtag('config', ga4_tag_id, { page_location: '/end-offer/one-click' });
    });
}
function implement_default_condition_change() {
    $('#js-default-condition').change(function () {
        var conditionId = $(this).val();
        preference_set('DefaultCondition', conditionId);
    });
}
function implement_show_default_condition() {
    var conditionId = preference_get('DefaultCondition') || "1";
    $('#js-default-condition').val(conditionId);
}
function show_collection_grade_tooltip() {
    $('.collection').on('click', '.stars span', function () {
        analytics_track_event('Tools', 'Collection', 'Show_GradeProfit_Tooltip');
        $(".tour").hide();
        var box = $(this).closest('.stars');
        box.find('.tour').show();
    });
    $('.collection').on('click', '.tour a.done', function (e) {
        e.preventDefault();
        $(this).closest('.tour').hide();
    });
}
function show_collection_change_tooltip() {
    $('.collection').on('click', '.change-icons span', function () {
        analytics_track_event('Tools', 'Collection', 'Show_GradeProfit_Tooltip');
        $(".tour").hide();
        var box = $(this).closest('.change-icons');
        box.find('.tour').show();
    });
    $('.collection').on('click', '.tour a.done', function (e) {
        e.preventDefault();
        $(this).closest('.tour').hide();
    });
}
function implement_remove_uid() {
    $('#comparing .remove').click(function (e) {
        e.preventDefault();
        var uid = $(e.target).data("uid");
        remove_from_uids_list(uid);
        submit_compare_form();
    });
}
function add_to_uids_list(uid) {
    var existingUids = $('#js-uids').val();
    var newUids = existingUids + "," + uid;
    if (existingUids === "") {
        newUids = uid;
    }
    var existingConditions = $('#js-conditions').val();
    var selectedCondition = $('#condition').val();
    var newConditions = existingConditions + "," + selectedCondition;
    if (existingConditions === "") {
        newConditions = selectedCondition;
    }
    $('#js-uids').val(newUids);
    $('#js-conditions').val(newConditions);
    return;
}
function remove_from_uids_list(uid) {
    var existingUids = $('#js-uids').val();
    var uidArray = existingUids.split(',');
    var index = uidArray.indexOf(uid);
    if (index > -1) {
        uidArray.splice(index, 1);
    }
    var conditions = $('#js-conditions').val();
    var conditionsArray = conditions.split(',');
    conditionsArray.splice(index, 1);
    var newUids = uidArray.join(',');
    var newConditions = conditionsArray.join(',');
    $('#js-uids').val(newUids);
    $('#js-conditions').val(newConditions);
    return newUids;
}
function submit_compare_form() {
    $("#processing").show();
    $("#js-select-items").hide();
    $('#js-compare').submit();
}
function implement_sales_details() {
    var used = 9;
    get_tab(used).click(show_sales(used));
    var cib = 2;
    get_tab(cib).click(show_sales(cib));
    var New = 8;
    get_tab(New).click(show_sales(New));
    var graded = 3;
    get_tab(graded).click(show_sales(graded));
    var boxOnly = 1;
    get_tab(boxOnly).click(show_sales(boxOnly));
    var manualOnly = 7;
    get_tab(manualOnly).click(show_sales(manualOnly));
    var pop = 14;
    get_tab(pop).click(show_pop(pop));
    var many = 0;
    get_tab(many).click(show_sales(many));
    var salesSelect = $('#completed-auctions-condition');
    salesSelect.change(function () {
        var value = $(this).val();
        select_tab_with_location_change(many);
        show_sales(many);
    });
    $('a.js-ebay-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'eBay', 'Product_Completed_Auctions', 74);
    });
    $('a.js-pcm-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'PriceCharting', 'Product_Completed_Auctions', 0);
    });
    $('a.js-ha-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'Heritage', 'Product_Completed_Auctions', 0);
    });
    $('a.js-pwcc-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'Fanatics', 'Product_Completed_Auctions', 0);
    });
    $('a.js-certifiedlink-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'CertifiedLink', 'Product_Completed_Auctions', 0);
    });
    $('a.js-tcgplayer-completed-sale').click(function (e) {
        analytics_track_event('Ads', 'TCGPlayer', 'Product_Completed_Auctions', 0);
    });
    $('.js-report-bad-sale').click(completed_auctions_thumbs_down_clicked);
}
function show_sales(tab) {
    return function (e) {
        var img = document.createElement('img');
        img.style["text-decoration"] = "none";
        img.style["border"] = "0";
        img.style["padding"] = "0";
        img.style["margin"] = "0";
        img.src = affiliate_impression_link(Affiliate.Ebay, 0, VGPC.product.id);
        document.getElementsByTagName('body')[0].appendChild(img);
        select_tab(tab);
        e.stopPropagation();
        return false;
    };
}
function change_sales_dropdown_to(tab) {
    if ($('#tab-bar .tab #completed-auctions-condition').length) {
        var wants = hash_name_for(tab);
        $('#completed-auctions-condition').val(wants);
    }
}
function show_pop(tab) {
    return function (e) {
        gtag('config', ga4_tag_id, { page_location: '/game-tab/population-report' });
        select_tab(tab);
        e.stopPropagation();
        return false;
    };
}
function condition_for_tab(tab) {
    if (tab == 0)
        return Condition.Loose;
    if (tab == 8)
        return Condition.New;
    if (tab == 2)
        return Condition.Cib;
    if (tab == 3)
        return Condition.GradedNew;
    if (tab == 1)
        return Condition.BoxOnly;
    if (tab == 7)
        return Condition.ManualOnly;
    return Condition.Loose;
}
function completed_auctions_thumbs_down_clicked(e) {
    var target = $(e.target);
    var tr = target.closest('tr');
    var item_id = extract_auction_id_from_tr(tr);
    tr.fadeOut();
    if (item_id)
        report_bad_auction(item_id);
    analytics_track_event('Tools', 'Product', 'Report Sale');
    e.preventDefault();
    return false;
}
function report_bad_auction(item_id) {
    $.ajax({
        type: 'POST',
        url: '/api/bad-sale',
        data: {
            "identifier": item_id
        },
        xhrFields: {
            withCredentials: true
        }
    });
}
function extract_auction_id_from_tr(tr) {
    var matches = tr.attr('id').match('^ebay-(\\d+)');
    if (matches)
        return matches[1];
    return '';
}
function implement_sort_sales_by_heading() {
    $('.sortable th').click(function () {
        var table = $(this).parents('table').eq(0);
        var rows = table.find('tr:gt(0)').toArray().sort(comparer($(this).index()));
        this.asc = !this.asc;
        if (!this.asc) {
            rows = rows.reverse();
        }
        for (var i = 0; i < rows.length; i++) {
            table.append(rows[i]);
        }
        var arrows = $(this).find(".arrow-up, .arrow-down");
        if (arrows.is(":visible")) {
            arrows.toggle();
        }
        else {
            $(this).find(".arrow-down").show();
        }
        $(this).siblings().find(".arrow-up, .arrow-down").hide();
        analytics_track_event('Tools', 'CompletedSales', 'ChangedSortOrder');
    });
}
function comparer(index) {
    return function (a, b) {
        var valA = getCellValue(a, index), valB = getCellValue(b, index);
        return $.isNumeric(valA) && $.isNumeric(valB) ? valA - valB : valA.localeCompare(valB);
    };
}
function show_sale_photo_tooltip() {
    $('.no-photo').click(function () {
        analytics_track_event('Tools', 'CompletedSales', 'TimeWarp_Show_Tooltip');
        $(".tour").hide();
        $(this).parent().find(".tour").show();
    });
    $('td.image div.image .tour a.done').click(function (e) {
        e.preventDefault();
        $(this).closest('.tour').hide();
    });
}
var filterControls = $('input[name="filter-source"]');
function filter_ungraded_sales_on_change() {
    var sales = $('.completed-auctions-used table.sortable tbody tr');
    filterControls.on('change', function () {
        var selectedSource = $(this).val();
        localStorage.setItem('salesFilterSource', selectedSource);
        apply_sales_filter(sales, selectedSource);
        analytics_track_event('Tools', 'Product', 'Filter Sales: ' + selectedSource, 0);
    });
}
function filter_ungraded_sales_on_load() {
    if ($('#filter-sales').length > 0) {
        var source = "ebay";
        var storedSource = localStorage.getItem('salesFilterSource');
        if (storedSource) {
            source = storedSource;
            filterControls.filter("[value=\"" + storedSource + "\"]").prop('checked', true);
        }
        var sales = $('.completed-auctions-used table.sortable tbody tr');
        apply_sales_filter(sales, source);
    }
}
function apply_sales_filter(sales, source) {
    sales.show();
    sales.filter(function () {
        if (source === 'all') {
            return false;
        }
        var titleColumnSelector = 'td.title';
        var titleTd = $(this).find(titleColumnSelector);
        var rowTitleText = titleTd.text().toLowerCase();
        var searchTerm = "[" + source + "]";
        if (rowTitleText.indexOf(searchTerm) === -1) {
            return true;
        }
        else {
            return false;
        }
    }).hide();
}
var Condition;
(function (Condition) {
    Condition[Condition["Loose"] = 1] = "Loose";
    Condition[Condition["New"] = 2] = "New";
    Condition[Condition["Cib"] = 3] = "Cib";
    Condition[Condition["Junk"] = 4] = "Junk";
    Condition[Condition["GradedNew"] = 5] = "GradedNew";
    Condition[Condition["BoxOnly"] = 6] = "BoxOnly";
    Condition[Condition["ManualOnly"] = 7] = "ManualOnly";
    Condition[Condition["LooseAndBox"] = 8] = "LooseAndBox";
    Condition[Condition["LooseAndManual"] = 9] = "LooseAndManual";
    Condition[Condition["BoxAndManual"] = 10] = "BoxAndManual";
    Condition[Condition["GradeThree"] = 13] = "GradeThree";
    Condition[Condition["GradeFour"] = 14] = "GradeFour";
    Condition[Condition["GradeFive"] = 15] = "GradeFive";
    Condition[Condition["GradeSix"] = 16] = "GradeSix";
    Condition[Condition["GradeSeventeen"] = 17] = "GradeSeventeen";
    Condition[Condition["GradeEighteen"] = 18] = "GradeEighteen";
    Condition[Condition["GradeNineteen"] = 19] = "GradeNineteen";
    Condition[Condition["GradeTwenty"] = 20] = "GradeTwenty";
    Condition[Condition["GradeTwentyOne"] = 21] = "GradeTwentyOne";
    Condition[Condition["GradeTwentyTwo"] = 22] = "GradeTwentyTwo";
})(Condition || (Condition = {}));
function condition_from_string(s) {
    switch (s.toLowerCase()) {
        case "brand new":
        case "new":
            return Condition.New;
        case "acceptable":
        case "good":
        case "like new":
        case "very good":
            return Condition.Loose;
        case "cib":
            return Condition.Cib;
        case "used":
            return Condition.Loose;
        case "graded":
        case "graded new":
        case "gradednew":
            return Condition.GradedNew;
        case "manualonly":
            return Condition.ManualOnly;
        case "boxonly":
            return Condition.BoxOnly;
        case "graded cib":
        case "gradedcib":
        case "gradethree":
            return Condition.GradeThree;
        case "gradefour":
            return Condition.GradeFour;
        case "gradefive":
            return Condition.GradeFive;
        case "gradesix":
            return Condition.GradeSix;
        case "boxandmanual":
            return Condition.BoxAndManual;
        case "gradeseventeen":
            return Condition.GradeSeventeen;
        case "gradeeightteen":
            return Condition.GradeEighteen;
        case "gradenineteen":
            return Condition.GradeNineteen;
        case "gradetwenty":
            return Condition.GradeTwenty;
        case "gradetwentyone":
            return Condition.GradeTwentyOne;
        case "gradetwentytwo":
            return Condition.GradeTwentyTwo;
    }
    console.log("Can't parse condition: " + s);
    return Condition.Loose;
}
var is_fetching_more_pages;
function implement_infinite_scrolling_console_page() {
    if ($('.js-console-page').length > 0) {
        $(window).scroll(console_page_on_scroll);
    }
}
function console_page_on_scroll() {
    if (is_fetching_more_pages)
        return;
    var win = $(window);
    if (win.scrollTop() + win.height() >= $(document).height() - 2000) {
        fetch_next_console_page();
    }
}
function fetch_next_console_page() {
    is_fetching_more_pages = true;
    var form = $('.js-next-page');
    if (form.length == 0) {
        infinite_scrolling_console_page_is_done();
        return;
    }
    $.get("?" + form.serialize(), { 'format': 'json' }, next_console_page_available);
}
function infinite_scrolling_console_page_is_done() {
    $(window).unbind('scroll', console_page_on_scroll);
    $('#games_table tfoot').remove();
}
function next_console_page_available(json) {
    var data = JSON.parse(json);
    var input = $('.js-next-page input[name=cursor]');
    var cursor = data.cursor;
    if (cursor) {
        input.val(cursor);
    }
    else {
        infinite_scrolling_console_page_is_done();
    }
    var tbody = $('#games_table tbody');
    if (tbody.length) {
        console.log("DEBUG is table view");
        for (var _i = 0, _a = data.products; _i < _a.length; _i++) {
            var product = _a[_i];
            var html = templates["console-row"].render(product);
            tbody.append(html);
        }
    }
    else {
        console.log("DEBUG is grid view");
        var grid = $('#grid-view');
        for (var _b = 0, _c = data.products; _b < _c.length; _b++) {
            var product = _c[_b];
            var html = templates["console-grid"].render(product);
            grid.append(html);
        }
    }
    is_fetching_more_pages = false;
}
function invert_sort_price() {
    $('.js-sort').click(function (e) {
        var category = VGPC.category || "video-games";
        var type = $(this).attr('id');
        var text = $(this).text();
        var isDown = text.search("▼");
        var mainForm = $("#mainForm");
        var sortForm = $("#sortForm");
        var newSort = "";
        if (category === "video-games") {
            if (type === "js-loose-price") {
                newSort = "highest-price";
                if (isDown != -1) {
                    newSort = "lowest-price";
                }
            }
            else if (type === "js-cib-price") {
                newSort = "highest-cib-price";
                if (isDown != -1) {
                    newSort = "lowest-cib-price";
                }
            }
            else if (type === "js-new-price") {
                newSort = "highest-new-price";
                if (isDown != -1) {
                    newSort = "lowest-new-price";
                }
            }
        }
        else if (category === "lego-sets") {
            if (type === "js-loose-price") {
                newSort = "highest-price";
                if (isDown != -1) {
                    newSort = "lowest-price";
                }
            }
            else if (type === "js-cib-price") {
                newSort = "highest-cib-price";
                if (isDown != -1) {
                    newSort = "lowest-cib-price";
                }
            }
            else if (type === "js-new-price") {
                newSort = "highest-new-price";
                if (isDown != -1) {
                    newSort = "lowest-new-price";
                }
            }
        }
        else if (category === "comic-books") {
            if (type === "js-loose-price") {
                newSort = "highest-price";
                if (isDown != -1) {
                    newSort = "lowest-price";
                }
            }
            else if (type === "js-cib-price") {
                newSort = "highest-new-price";
                if (isDown != -1) {
                    newSort = "lowest-new-price";
                }
            }
            else if (type === "js-new-price") {
                newSort = "highest-graded-price";
                if (isDown != -1) {
                    newSort = "lowest-graded-price";
                }
            }
        }
        else {
            if (type === "js-loose-price") {
                newSort = "highest-price";
                if (isDown != -1) {
                    newSort = "lowest-price";
                }
            }
            else if (type === "js-cib-price") {
                newSort = "highest-graded-price";
                if (isDown != -1) {
                    newSort = "lowest-graded-price";
                }
            }
            else if (type === "js-new-price") {
                newSort = "highest-manual-price";
                if (isDown != -1) {
                    newSort = "lowest-manual-price";
                }
            }
        }
        sortForm.empty().append("<option value=\"" + newSort + "\"></option>");
        mainForm.submit();
    });
}
function implement_sticky_headers() {
    var table = document.getElementById('games_table');
    if (table) {
    }
    else {
        return;
    }
    var tableContainer = table.parentElement, tableHeaders = table.children[0], cloneContainer = document.createElement("div"), cloneTable = document.createElement("table"), cloneHeaders = document.createElement("thead");
    cloneTable.id = "games_table_sticky";
    var render = function () {
        if (cloneContainer.children.length > 0) {
            cloneTable.removeChild(cloneHeaders);
            cloneContainer.removeChild(cloneTable);
            cloneTable = document.createElement("table");
            cloneTable.id = "games_table_sticky";
            cloneHeaders = document.createElement("thead");
        }
        var yOffset = tableHeaders.getClientRects().item(0).top;
        if (yOffset > 0) {
            return;
        }
        var left = tableHeaders.getClientRects().item(0).left;
        cloneContainer.style.cssText = "top: 0px; left: " + left + "px; position: fixed";
        var tr = tableHeaders.children.item(0), cloneRow = document.createElement("tr");
        Array.prototype.forEach.call(tr.children, function (th) {
            var thRects = th.getClientRects();
            if (thRects.length === 0) {
                return;
            }
            var cloneHeader = document.createElement("th"), headerWidth = th.getClientRects().item(0).width;
            cloneHeader.innerHTML = th.innerHTML;
            cloneHeader.style.minWidth = headerWidth - 10 + "px";
            Array.prototype.forEach.call(th.classList, function (className) {
                cloneHeader.classList.add(className);
            });
            cloneRow.appendChild(cloneHeader);
        });
        cloneHeaders.appendChild(cloneRow);
        cloneTable.appendChild(cloneHeaders);
        cloneContainer.appendChild(cloneTable);
        tableContainer.appendChild(cloneContainer);
    };
    window.addEventListener('scroll', function (e) {
        window.requestAnimationFrame(function () { return render(); });
    });
    window.addEventListener('resize', function (e) {
        window.requestAnimationFrame(function () { return render(); });
    });
}
function createCookie(name, value, days) {
    var expires;
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    else {
        expires = "";
    }
    var s = encodeURIComponent(name)
        + "="
        + encodeURIComponent(value)
        + expires
        + "; path=/";
    document.cookie = s;
}
function readCookie(name) {
    var nameEQ = encodeURIComponent(name) + "=";
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ')
            c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0)
            return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}
function eraseCookie(name) {
    createCookie(name, "", -1);
}
var CurrencySign = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    AED: 'AED',
    AUD: 'A ',
    CAD: 'C ',
    MXN: 'M ',
    BRL: 'R ',
    NZD: 'NZ ',
    CNY: 'CN ',
    JPY: '¥',
    HKD: 'HK ',
    NOK: 'NOK',
    SEK: 'SEK',
    SGD: 'SGD',
    CHF: '₣',
    IDR: 'Rp',
    PHP: '₱',
    INR: '₹',
    MYR: 'RM ',
    DKK: 'kr ',
    PLN: 'zl '
};
var CurrencyCode = {
    USD: 'USD',
    CAD: 'CAD',
    EUR: 'EUR',
    GBP: 'GBP',
    AED: 'AED',
    AUD: 'AUD',
    MXN: 'MXN',
    BRL: 'BRL',
    NZD: 'NZD',
    CNY: 'CNY',
    JPY: 'JPY',
    HKD: 'HKD',
    NOK: 'NOK',
    SEK: 'SEK',
    SGD: 'SGD',
    CHF: 'CHF',
    IDR: 'IDR',
    PHP: 'PHP',
    INR: 'INR',
    MYR: 'MYR',
    DKK: 'DKK',
    PLN: 'PLN'
};
var currencySignRegEx = currencySignsAsRegExString();
var currencyRegEx = new RegExp("(((" + currencySignRegEx + ")))");
var priceNumberRegEx = /[0-9]+(?:\.\d\d)?/g;
var iframeSelector = "iframe[src^=\"" + document.defaultView.location.origin + "\"]";
function convertCurrencyCodeToSign(currencyCode) {
    switch (currencyCode) {
        case CurrencyCode.USD:
            return CurrencySign.USD;
        case CurrencyCode.EUR:
            return CurrencySign.EUR;
        case CurrencyCode.GBP:
            return CurrencySign.GBP;
        case CurrencyCode.CAD:
            return CurrencySign.CAD;
        case CurrencyCode.AED:
            return CurrencySign.AED;
        case CurrencyCode.AUD:
            return CurrencySign.AUD;
        case CurrencyCode.MXN:
            return CurrencySign.MXN;
        case CurrencyCode.BRL:
            return CurrencySign.BRL;
        case CurrencyCode.NZD:
            return CurrencySign.NZD;
        case CurrencyCode.CNY:
            return CurrencySign.CNY;
        case CurrencyCode.JPY:
            return CurrencySign.JPY;
        case CurrencyCode.HKD:
            return CurrencySign.HKD;
        case CurrencyCode.NOK:
            return CurrencySign.NOK;
        case CurrencyCode.SEK:
            return CurrencySign.SEK;
        case CurrencyCode.SGD:
            return CurrencySign.SGD;
        case CurrencyCode.CHF:
            return CurrencySign.CHF;
        case CurrencyCode.IDR:
            return CurrencySign.IDR;
        case CurrencyCode.PHP:
            return CurrencySign.PHP;
        case CurrencyCode.INR:
            return CurrencySign.INR;
        case CurrencyCode.MYR:
            return CurrencySign.MYR;
        case CurrencyCode.DKK:
            return CurrencySign.DKK;
        case CurrencyCode.PLN:
            return CurrencySign.PLN;
        default:
            return currencyCode;
    }
}
function convertCurrencySignToCode(currencySign) {
    switch (currencySign) {
        case CurrencySign.USD:
            return CurrencyCode.USD;
        case CurrencySign.EUR:
            return CurrencyCode.EUR;
        case CurrencySign.GBP:
            return CurrencyCode.GBP;
        case CurrencySign.CAD:
            return CurrencyCode.CAD;
        case CurrencySign.AED:
            return CurrencyCode.AED;
        case CurrencySign.AUD:
            return CurrencyCode.AUD;
        case CurrencySign.MXN:
            return CurrencyCode.MXN;
        case CurrencySign.BRL:
            return CurrencyCode.BRL;
        case CurrencySign.NZD:
            return CurrencyCode.NZD;
        case CurrencySign.CNY:
            return CurrencyCode.CNY;
        case CurrencySign.JPY:
            return CurrencyCode.JPY;
        case CurrencySign.HKD:
            return CurrencyCode.HKD;
        case CurrencySign.NOK:
            return CurrencyCode.NOK;
        case CurrencySign.SEK:
            return CurrencyCode.SEK;
        case CurrencySign.SGD:
            return CurrencyCode.SGD;
        case CurrencySign.CHF:
            return CurrencyCode.CHF;
        case CurrencySign.IDR:
            return CurrencyCode.IDR;
        case CurrencySign.PHP:
            return CurrencyCode.PHP;
        case CurrencySign.INR:
            return CurrencyCode.INR;
        case CurrencySign.MYR:
            return CurrencyCode.MYR;
        case CurrencySign.DKK:
            return CurrencyCode.DKK;
        case CurrencySign.PLN:
            return CurrencyCode.PLN;
        default:
            return currencySign;
    }
}
function currencySignsAsRegExString() {
    return Object.keys(CurrencySign).map(function (currencyCode) { return "\\" + CurrencySign[currencyCode]; }).join('|');
}
function update_currency_from_local_storage() {
    var currency = localStorage.getItem('currency');
    if (currency) {
        update_selected_currency(currency);
    }
}
$(document).on('ready ajaxComplete', function () {
    setTimeout(function () {
        update_currency_from_local_storage();
    }, 10);
});
$('#currency_selector ul a').click(function (event) {
    var target = event.target;
    var currency = target.dataset.currency;
    var previousCurrency = $('#dropdown_selected_currency').text();
    localStorage.setItem('currency', currency);
    update_selected_currency(currency);
});
function update_selected_currency(currency) {
    $('#dropdown_selected_currency').text(currency);
    var priceElements = $('.js-price').add($(iframeSelector).contents().find('.js-price'));
    priceElements.each(function (index) {
        var currentElement = $(priceElements[index]);
        var currentPrice = currentElement.text();
        currentPrice = currentPrice.replace(/,/g, "");
        if (!currentPrice || currentPrice === 'N/A') {
            return;
        }
        var previousCurrencySignMatches = currentPrice.match(currencyRegEx);
        var priceInPreviousCurrencyMatches = currentPrice.match(priceNumberRegEx);
        if (!previousCurrencySignMatches || !priceInPreviousCurrencyMatches) {
            return;
        }
        var previousCurrencySign = previousCurrencySignMatches[0];
        var priceInPreviousCurrency = priceInPreviousCurrencyMatches[0];
        var previousCurrencyCode = convertCurrencySignToCode(previousCurrencySign);
        var priceInPreviousCurrencyAsNumber = parseFloat(priceInPreviousCurrency);
        var priceInNewCurrency = convert_price_currency(priceInPreviousCurrencyAsNumber, currency, previousCurrencyCode);
        var currencySign = convertCurrencyCodeToSign(currency);
        var newNumberPortion = Number(priceInNewCurrency).toFixed(2);
        newNumberPortion = newNumberPortion.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        var currencyFull = Object.keys(CurrencySign).indexOf(currency) !== -1
            ? "" + currencySign + newNumberPortion : newNumberPortion + " " + currency;
        $(priceElements[index]).text(currencyFull);
        $(document).trigger('currencyChanged', [currency]);
    });
    if ($('.js-profit').length) {
        var valueElements_1 = $('.js-value').add($(iframeSelector).contents().find('.js-value'));
        var costElements_1 = $('.js-cost').add($(iframeSelector).contents().find('.js-cost'));
        var profitElements_1 = $('.js-profit').add($(iframeSelector).contents().find('.js-profit'));
        valueElements_1.each(function (index) {
            var value = $(valueElements_1[index]).text();
            value = value.replace(/,/g, "");
            var valueRegEx = value.match(priceNumberRegEx)[0];
            var cost = $(costElements_1[index]).text();
            var valueNumber = parseFloat(valueRegEx);
            var costNumber = parseFloat(cost);
            var profit = valueNumber - costNumber;
            if (profit < 0) {
                profit = 0;
            }
            var profitString = profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            $(profitElements_1[index]).text(profitString);
        });
    }
}
function convert_price_currency(price, newCurrency, previousCurrency) {
    var newPriceInUSD = previousCurrency === CurrencyCode.USD ? price : price / VGPC.forex_rates[previousCurrency];
    var priceInNewCurrency = newCurrency === CurrencyCode.USD ? newPriceInUSD : newPriceInUSD * VGPC.forex_rates[newCurrency];
    return priceInNewCurrency;
}
function implement_compare_prices_tracking() {
    $('table.used-prices td.see-it a').click(function (e) {
        var a = $(e.target).closest('a');
        var affiliate_name = a.data('affiliate');
        var affiliate = affiliate_from_name(affiliate_name);
        if (affiliate == Affiliate.Pcm) {
            analytics_track_event('Market', 'Came-from', 'Product-SeeIt');
        }
        var value = ad_unit_value(affiliate, 1);
        analytics_track_event('Ads', affiliate_name, 'Product_Compare_Prices', value);
        return true;
    });
    $('#js-tcg-id-link').click(function (e) {
        analytics_track_event('Ads', 'TCGPlayer', 'Product_ID_Link', 0);
        return true;
    });
    $('#grade-cos .img_container a').click(function (e) {
        var a = $(e.target).closest('a');
        var grade_co_name = a.data('company');
        analytics_track_event('Ads', grade_co_name, 'GradeCoButton', 0);
        return true;
    });
}
var Hogan = {
    Template: function (codeObj, text, compiler, options) { }
};
var templates = {};
(function (Hogan) {
    Hogan.Template = function (codeObj, text, compiler, options) {
        codeObj = codeObj || {};
        this.r = codeObj.code || this.r;
        this.c = compiler;
        this.options = options || {};
        this.text = text || '';
        this.partials = codeObj.partials || {};
        this.subs = codeObj.subs || {};
        this.buf = '';
    };
    Hogan.Template.prototype = {
        r: function (context, partials, indent) { return ''; },
        v: hoganEscape,
        t: coerceToString,
        render: function render(context, partials, indent) {
            return this.ri([context], partials || {}, indent);
        },
        ri: function (context, partials, indent) {
            return this.r(context, partials, indent);
        },
        ep: function (symbol, partials) {
            var partial = this.partials[symbol];
            var template = partials[partial.name];
            if (partial.instance && partial.base == template) {
                return partial.instance;
            }
            if (typeof template == 'string') {
                if (!this.c) {
                    throw new Error("No compiler available.");
                }
                template = this.c.compile(template, this.options);
            }
            if (!template) {
                return null;
            }
            this.partials[symbol].base = template;
            if (partial.subs) {
                if (!partials.stackText)
                    partials.stackText = {};
                for (var key in partial.subs) {
                    if (!partials.stackText[key]) {
                        partials.stackText[key] = (this.activeSub !== undefined && partials.stackText[this.activeSub]) ? partials.stackText[this.activeSub] : this.text;
                    }
                }
                template = createSpecializedPartial(template, partial.subs, partial.partials, this.stackSubs, this.stackPartials, partials.stackText);
            }
            this.partials[symbol].instance = template;
            return template;
        },
        rp: function (symbol, context, partials, indent) {
            var partial = this.ep(symbol, partials);
            if (!partial) {
                return '';
            }
            return partial.ri(context, partials, indent);
        },
        rs: function (context, partials, section) {
            var tail = context[context.length - 1];
            if (!isArray(tail)) {
                section(context, partials, this);
                return;
            }
            for (var i = 0; i < tail.length; i++) {
                context.push(tail[i]);
                section(context, partials, this);
                context.pop();
            }
        },
        s: function (val, ctx, partials, inverted, start, end, tags) {
            var pass;
            if (isArray(val) && val.length === 0) {
                return false;
            }
            if (typeof val == 'function') {
                val = this.ms(val, ctx, partials, inverted, start, end, tags);
            }
            pass = !!val;
            if (!inverted && pass && ctx) {
                ctx.push((typeof val == 'object') ? val : ctx[ctx.length - 1]);
            }
            return pass;
        },
        d: function (key, ctx, partials, returnFound) {
            var found, names = key.split('.'), val = this.f(names[0], ctx, partials, returnFound), doModelGet = this.options.modelGet, cx = null;
            if (key === '.' && isArray(ctx[ctx.length - 2])) {
                val = ctx[ctx.length - 1];
            }
            else {
                for (var i = 1; i < names.length; i++) {
                    found = findInScope(names[i], val, doModelGet);
                    if (found !== undefined) {
                        cx = val;
                        val = found;
                    }
                    else {
                        val = '';
                    }
                }
            }
            if (returnFound && !val) {
                return false;
            }
            if (!returnFound && typeof val == 'function') {
                ctx.push(cx);
                val = this.mv(val, ctx, partials);
                ctx.pop();
            }
            return val;
        },
        f: function (key, ctx, partials, returnFound) {
            var val = false, v = null, found = false, doModelGet = this.options.modelGet;
            for (var i = ctx.length - 1; i >= 0; i--) {
                v = ctx[i];
                val = findInScope(key, v, doModelGet);
                if (val !== undefined) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return (returnFound) ? false : "";
            }
            if (!returnFound && typeof val == 'function') {
                val = this.mv(val, ctx, partials);
            }
            return val;
        },
        ls: function (func, cx, partials, text, tags) {
            var oldTags = this.options.delimiters;
            this.options.delimiters = tags;
            this.b(this.ct(coerceToString(func.call(cx, text)), cx, partials));
            this.options.delimiters = oldTags;
            return false;
        },
        ct: function (text, cx, partials) {
            if (this.options.disableLambda) {
                throw new Error('Lambda features disabled.');
            }
            return this.c.compile(text, this.options).render(cx, partials);
        },
        b: function (s) { this.buf += s; },
        fl: function () { var r = this.buf; this.buf = ''; return r; },
        ms: function (func, ctx, partials, inverted, start, end, tags) {
            var textSource, cx = ctx[ctx.length - 1], result = func.call(cx);
            if (typeof result == 'function') {
                if (inverted) {
                    return true;
                }
                else {
                    textSource = (this.activeSub && this.subsText && this.subsText[this.activeSub]) ? this.subsText[this.activeSub] : this.text;
                    return this.ls(result, cx, partials, textSource.substring(start, end), tags);
                }
            }
            return result;
        },
        mv: function (func, ctx, partials) {
            var cx = ctx[ctx.length - 1];
            var result = func.call(cx);
            if (typeof result == 'function') {
                return this.ct(coerceToString(result.call(cx)), cx, partials);
            }
            return result;
        },
        sub: function (name, context, partials, indent) {
            var f = this.subs[name];
            if (f) {
                this.activeSub = name;
                f(context, partials, this, indent);
                this.activeSub = false;
            }
        }
    };
    function findInScope(key, scope, doModelGet) {
        var val;
        if (scope && typeof scope == 'object') {
            if (scope[key] !== undefined) {
                val = scope[key];
            }
            else if (doModelGet && scope.get && typeof scope.get == 'function') {
                val = scope.get(key);
            }
        }
        return val;
    }
    function createSpecializedPartial(instance, subs, partials, stackSubs, stackPartials, stackText) {
        function PartialTemplate() { }
        ;
        PartialTemplate.prototype = instance;
        function Substitutions() { }
        ;
        Substitutions.prototype = instance.subs;
        var key;
        var partial = new PartialTemplate();
        partial.subs = new Substitutions();
        partial.subsText = {};
        partial.buf = '';
        stackSubs = stackSubs || {};
        partial.stackSubs = stackSubs;
        partial.subsText = stackText;
        for (key in subs) {
            if (!stackSubs[key])
                stackSubs[key] = subs[key];
        }
        for (key in stackSubs) {
            partial.subs[key] = stackSubs[key];
        }
        stackPartials = stackPartials || {};
        partial.stackPartials = stackPartials;
        for (key in partials) {
            if (!stackPartials[key])
                stackPartials[key] = partials[key];
        }
        for (key in stackPartials) {
            partial.partials[key] = stackPartials[key];
        }
        return partial;
    }
    var rAmp = /&/g, rLt = /</g, rGt = />/g, rApos = /\'/g, rQuot = /\"/g, hChars = /[&<>\"\']/;
    function coerceToString(val) {
        return String((val === null || val === undefined) ? '' : val);
    }
    function hoganEscape(str) {
        str = coerceToString(str);
        return hChars.test(str) ?
            str
                .replace(rAmp, '&amp;')
                .replace(rLt, '&lt;')
                .replace(rGt, '&gt;')
                .replace(rApos, '&#39;')
                .replace(rQuot, '&quot;') :
            str;
    }
    var isArray = Array.isArray || function (a) {
        return Object.prototype.toString.call(a) === '[object Array]';
    };
})(Hogan);
function implement_ebay_lot_page() {
    implement_lot_search_autocomplete();
    implement_lot_item_delete();
    lot_bot_tour();
    want_to_see_tour("lot-bot.tour");
    lot_bot_console_filter();
}
function implement_lot_item_delete() {
    $('.js-lot-delete-item').click(lot_on_delete);
}
function lot_on_delete(e) {
    e.preventDefault();
    var item_count = $(e.target).closest('tbody').find('tr').length;
    if (item_count == 1) {
        return;
    }
    $(e.target).closest('tr').remove();
    lot_recalculate_value();
}
function implement_lot_search_autocomplete() {
    var search_box = $('.js-lot-search');
    search_box.closest('form').submit(function (e) { e.preventDefault(); });
    search_box.autocomplete({
        'minLength': 3,
        'autoFocus': true,
        'open': function () { $('ul.ui-autocomplete').css('width', 570); },
        'source': lot_search_source,
        'select': lot_search_select,
        'delay': 150,
    });
}
var lot_search_cache = {};
var lot_search_last_xhr;
function lot_search_source(request, response) {
    var console_uid = VGPC.lot.console_uid;
    request['console-uid'] = console_uid;
    var term = request['term'];
    request['q'] = term;
    delete request['term'];
    var cache_key = term + '|' + console_uid;
    if (cache_key in cart_search_cache) {
        var data = cart_search_cache[cache_key];
        lot_handle_search_results(term, data, response);
        return;
    }
    lot_search_last_xhr = $.getJSON("/search-products?type=cart", request, function (data, status, xhr) {
        cart_search_cache[cache_key] = data;
        if (xhr === lot_search_last_xhr) {
            lot_handle_search_results(term, data, response);
        }
    });
}
function lot_search_select(_event, ui) {
    var item = new CartItem(ui['item']);
    lot_add_item(item);
    clear_and_focus_lot_search_box();
}
function lot_handle_search_results(term, data, response) {
    search_results_found(data.length);
    response(data);
}
function clear_and_focus_lot_search_box() {
    window.setTimeout(function () {
        $('.js-lot-search').val('').focus().keydown();
    }, 1);
}
function lot_add_item(item) {
    var template = $('#listing-items tbody tr').first().clone();
    template.find('.product-name').text(item.label);
    template.find('.price').text(item.price().toString());
    template.find('.js-lot-delete-item').click(lot_on_delete);
    $('#listing-items tbody').prepend(template);
    lot_recalculate_value();
}
function lot_recalculate_value() {
    var value = new Currency(0);
    $('#listing-items tbody td.price').each(function (i, td) {
        var price = Currency.fromString($(td).text());
        value = value.plus(price);
    });
    $('.js-lot-value').text(value.toString());
}
function lot_bot_console_filter() {
    $("#console-uid").change(function (e) {
        var consoleSelected = $("#console-uid option:selected").val();
        if (consoleSelected == "moreConsoles") {
            $("#js-tour4").show();
            e.preventDefault();
        }
        else {
            this.form.submit();
        }
    });
}
function lot_bot_tour() {
    $("#js-tour0").click(function (e) {
        e.preventDefault();
        $("#js-tour1").show();
    });
    $("#js-tour1 > a").click(function (e) {
        e.preventDefault();
        $("#js-tour1").hide();
        $("#js-tour2").show();
    });
    $("#js-tour2 > a").click(function (e) {
        e.preventDefault();
        $("#js-tour2").hide();
        $("#js-tour3").show();
    });
    $("#js-tour3 > a").click(function (e) {
        e.preventDefault();
        $("#js-tour3").hide();
        $("#js-tour4").show();
    });
    $("#js-tour4 > a.done").click(function (e) {
        e.preventDefault();
        $("#js-tour4").hide();
        $("#js-tour0").show();
    });
}
var CartItem = (function () {
    function CartItem(raw_item, defaultCondition) {
        if (defaultCondition === void 0) { defaultCondition = Condition.Loose; }
        this.id = raw_item["id"];
        this.console = raw_item["console"];
        this.is_card = raw_item["is_card"];
        this.is_video_game = raw_item["is_video_game"];
        this.is_comic_book = raw_item["is_comic_book"];
        this.is_funko = raw_item["is_funko"];
        this.is_lego = raw_item["is_comic_book"];
        this.is_coin = raw_item["is_coin"];
        this.label = raw_item["label"];
        this.prices = [];
        this.retail_buy = [];
        this.retail_sell = [];
        this.gamestop_buy = [];
        this.gamestop_sell = [];
        this.price_type = 0;
        var c = raw_item["condition"];
        if (typeof (c) == "number") {
            this.condition = c;
        }
        else {
            this.condition = defaultCondition;
        }
        for (var _i = 0, _a = ['prices', 'retail_buy', 'retail_sell', 'gamestop_buy', 'gamestop_sell']; _i < _a.length; _i++) {
            var type = _a[_i];
            for (var k = 0; k < 6; k++) {
                var raw_price = raw_item[type][k];
                switch (typeof (raw_price)) {
                    case "string":
                        this[type][k] = Currency.fromString(raw_price);
                        break;
                    case "number":
                        this[type][k] = new Currency(raw_price);
                        break;
                }
            }
        }
        var uuid = raw_item["uuid"];
        if (uuid) {
            this.uuid = uuid;
        }
        else {
            this.uuid = Math.random().toString().replace(/^0[.]/, "u");
        }
    }
    CartItem.prototype.product_name = function () {
        return this.label;
    };
    CartItem.prototype.console_name = function () {
        return this.console;
    };
    CartItem.prototype.is_loose = function () {
        return this.condition == Condition.Loose;
    };
    CartItem.prototype.is_cib = function () {
        return this.condition == Condition.Cib;
    };
    CartItem.prototype.is_new = function () {
        return this.condition == Condition.New;
    };
    CartItem.prototype.is_graded = function () {
        return this.condition == Condition.GradedNew;
    };
    CartItem.prototype.is_boxonly = function () {
        return this.condition == Condition.BoxOnly;
    };
    CartItem.prototype.is_manualonly = function () {
        return this.condition == Condition.ManualOnly;
    };
    CartItem.prototype.is_a_card = function () {
        return this.is_card == "true";
    };
    CartItem.prototype.is_videogame = function () {
        return this.is_video_game == "true";
    };
    CartItem.prototype.is_comic = function () {
        return this.is_comic_book == "true";
    };
    CartItem.prototype.is_a_funko = function () {
        return this.is_funko == "true";
    };
    CartItem.prototype.is_a_lego = function () {
        return this.is_lego == "true";
    };
    CartItem.prototype.is_a_coin = function () {
        return this.is_coin == "true";
    };
    CartItem.prototype.local_storage_key = function () {
        return "CartItems." + this.uuid;
    };
    CartItem.prototype.write_to_localstorage = function () {
        localStorage[this.local_storage_key()] = JSON.stringify(this);
    };
    CartItem.prototype.price = function () {
        var n = this.condition_index();
        switch (this.price_type) {
            case 0:
                return this.prices[n];
            case 1:
                return this.retail_buy[n];
            case 2:
                return this.retail_sell[n];
            case 3:
                return this.gamestop_buy[n];
            case 4:
                return this.gamestop_sell[n];
        }
        throw ("unexpected price type");
    };
    CartItem.prototype.condition_index = function () {
        switch (this.condition) {
            case Condition.Loose:
                return 0;
            case Condition.New:
                return 1;
            case Condition.Cib:
                return 2;
            case Condition.GradedNew:
                return 3;
            case Condition.BoxOnly:
                return 4;
            case Condition.ManualOnly:
                return 5;
        }
    };
    return CartItem;
}());
var defaultConditionStorageKey = 'lot-calculator.default-condition';
var defaultPrintMessageStorageKey = 'lot-calculator.print-message';
function implement_lot_calculator() {
    if (window.location.hostname.indexOf("sportscardspro") === -1) {
        implement_console_selection_widget({
            maximum_consoles_to_render: 2,
            display_method: 1,
            retain_selected_consoles: true
        });
    }
    implement_cart_search_autocomplete();
    implement_cart_empty_button();
    implement_cart_settings();
    restore_cart_contents();
    update_cart_totals();
    pricingcart_tour();
    want_to_see_tour("lot-calculator.tour");
}
function to_string(s) {
    return "" + s;
}
;
function to_float(x) {
    if (x == null)
        return null;
    var f = parseFloat(x);
    if (isNaN(f))
        return null;
    return f;
}
;
function float_equals(x, y) {
    return Math.abs(x - y) < 0.01;
}
;
var cart_settings = {
    'SalesTaxRate': {
        'default-value': 0,
        'read': to_float,
        'show': to_string,
        'equals': float_equals,
        'error': 'Enter a percentage or 0 to disable tax'
    },
    'PercentageMarkup': {
        'default-value': 0,
        'read': to_float,
        'show': to_string,
        'equals': float_equals,
        'error': 'Invalid percentage markup amount. Using 0'
    },
    'FlatFeeMarkup': {
        'default-value': new Currency(0),
        'read': function (s) {
            if (s == null)
                return null;
            return Currency.maybeFromString(s);
        },
        'show': function (c) {
            return c.toString().replace('$', '');
        },
        'equals': function (a, b) { return a.pennies == b.pennies; },
        'error': 'Invalid flat fee markup amount. Using 0.00'
    },
    'PriceType': {
        'default-value': 'prices',
        'read': function (s) {
            if (s == 'prices')
                return s;
            if (s == 'retail_sell')
                return s;
            if (s == 'retail_buy')
                return s;
            if (s == 'gamestop_sell')
                return s;
            if (s == 'gamestop_buy')
                return s;
            return null;
        },
        'show': function (s) { return s; },
        'equals': function (a, b) { return a == b; },
        'error': 'Select a valid price type'
    }
};
$(document).ready(function () {
    var defaultConditionSelectInput = $('#default-condition');
    var defaultCondition = localStorage.getItem(defaultConditionStorageKey);
    if (defaultCondition) {
        defaultConditionSelectInput.val(defaultCondition);
    }
    defaultConditionSelectInput.on("change", function (event) { return localStorage.setItem(defaultConditionStorageKey, event.target.value); });
    if (VGPC.is_pro) {
        var defaultPrintMessageInput_1 = $('#print-message');
        var printMessage = defaultPrintMessageInput_1.val();
        var storedPrintMessage = localStorage.getItem(defaultPrintMessageStorageKey);
        if (storedPrintMessage) {
            printMessage = storedPrintMessage;
            defaultPrintMessageInput_1.val(printMessage);
        }
        $('#js-print-header').text(printMessage);
        defaultPrintMessageInput_1.on("change", function () {
            localStorage.setItem(defaultPrintMessageStorageKey, event.target.value);
            $('#js-print-header').text(defaultPrintMessageInput_1.val());
        });
    }
});
$(document).on('cartChanged', function () {
    update_currency_from_local_storage();
});
$(document).on('currencyChanged', function (event, currency) {
    update_flat_on_currency_change(currency);
});
function update_flat_on_currency_change(currency) {
    var currecnySignElement = $('#flat-currency');
    var flatInput = $('#FlatFeeMarkup');
    var previousCurrencySign = $('#flat-currency').text();
    var previousCurrencyCode = convertCurrencySignToCode(previousCurrencySign);
    var newCurrecnySign = convertCurrencyCodeToSign(currency);
    var flatInPreviousCurrency = parseFloat($('#FlatFeeMarkup').val());
    currecnySignElement.text(newCurrecnySign);
    if (isNaN(flatInPreviousCurrency)) {
        return;
    }
    var newFlat = convert_price_currency(flatInPreviousCurrency, currency, previousCurrencyCode);
    flatInput.val(Number(newFlat).toFixed(2));
}
function convert_currency_to_us_dollars(currency) {
    var currencyCode = $('#dropdown_selected_currency').text();
    var price = currency.pennies / 100;
    var priceInUSDollars = currencyCode === CurrencyCode.USD ? price : price / VGPC.forex_rates[currencyCode];
    return new Currency(Math.round(priceInUSDollars * 100));
}
function get_cart_setting(name) {
    var vtable = cart_settings[name];
    if (vtable == null)
        throw "Invalid cart setting name " + name;
    var node = $('#' + name);
    var text = node.val();
    var value = vtable['read'](text);
    if (value == null) {
        cart_settings_error(node, vtable['error']);
        value = vtable['default-value'];
    }
    else {
        cart_settings_error(node, '');
        var previous = node.data('previous-' + name);
        if (!vtable['equals'](previous, value)) {
            var valueToSave = name === 'FlatFeeMarkup' ? convert_currency_to_us_dollars(value) : value;
            preference_set('Cart' + name, vtable['show'](valueToSave));
            node.data('previous-' + name, valueToSave);
        }
    }
    return value;
}
function render_cart_row(raw_item, markup) {
    var item = markup(raw_item);
    switch (get_cart_setting('PriceType')) {
        case "prices":
            item.price_type = 0;
            break;
        case "retail_buy":
            item.price_type = 1;
            break;
        case "retail_sell":
            item.price_type = 2;
            break;
        case "gamestop_buy":
            item.price_type = 3;
            break;
        case "gamestop_sell":
            item.price_type = 4;
            break;
    }
    var html = templates["calculator-row"].render(item);
    var tr = $(html);
    tr.data('item-details', raw_item);
    tr.find('.condition select').change(cart_change_condition);
    tr.find('.remove').click(cart_remove_item);
    return tr;
}
function restore_cart_contents() {
    $('#cart-empty').click();
    for (var key_1 in localStorage) {
        if (key_1 === undefined)
            continue;
        if (key_1.indexOf("CartItems.") == 0) {
            var raw_item = JSON.parse(localStorage[key_1]);
            var item = new CartItem(raw_item);
            cart_add_item(item);
        }
    }
}
function update_cart_totals() {
    var count = cart_item_count() + "";
    var total = new Currency(0);
    var markup = get_markup_fn();
    var type = get_cart_setting('PriceType');
    $('#cart-contents tbody tr').each(function () {
        var raw_item = get_item_details($(this));
        var item = markup(raw_item);
        var condition = item.condition;
        var price;
        if (condition == Condition.Loose) {
            price = item[type][0];
        }
        else if (condition == Condition.New) {
            price = item[type][1];
        }
        else if (condition == Condition.Cib) {
            price = item[type][2];
        }
        else if (condition == Condition.GradedNew) {
            price = item[type][3];
        }
        else if (condition == Condition.BoxOnly) {
            price = item[type][4];
        }
        else if (condition == Condition.ManualOnly) {
            price = item[type][5];
        }
        total = total.plus(price);
    });
    var tax_rate = get_sales_tax_rate();
    var tax = total.multiply(tax_rate);
    var grand_total = tax.plus(total);
    $('#cart-totals #count').text(count);
    $('#cart-totals #total').text(total.toString());
    $('#cart-contents #sales-tax').text(tax.toString());
    $('#cart-contents #grand-total').text(grand_total.toString());
}
function update_cart_rows() {
    var markup = get_markup_fn();
    $('#cart-contents tbody tr').each(function () {
        var tr = $(this);
        var item = get_item_details(tr);
        var new_tr = render_cart_row(item, markup);
        tr.replaceWith(new_tr);
    });
    update_cart_totals();
}
function get_sales_tax_rate() {
    var rate = (get_cart_setting('SalesTaxRate'));
    var cart_footer = $('#cart-contents tfoot tr');
    if (rate < 0.01) {
        cart_footer.hide();
        return 0;
    }
    cart_footer.show();
    return rate / 100;
}
function get_markup_fn() {
    var flat = get_cart_setting('FlatFeeMarkup');
    var percentage = get_cart_setting('PercentageMarkup');
    var type = get_cart_setting('PriceType');
    var flatInUSDollars = convert_currency_to_us_dollars(flat);
    return function (raw_item) {
        var item = $.extend(true, {}, raw_item);
        var size = item[type].length;
        for (var i = 0; i < size; i++) {
            var price = item[type][i];
            item[type][i] = price.multiply(1 + percentage / 100).plus(flatInUSDollars);
        }
        return item;
    };
}
function cart_settings_error(node, message) {
    node.parents('tr').find('.error').text(message);
}
function get_item_details(tr) {
    return tr.data('item-details');
}
function cart_item_count() {
    var rows = $('#cart-contents tbody tr');
    return rows.length;
}
function clear_and_focus_cart_search_box() {
    window.setTimeout(function () {
        $('#cart-search').val('').focus().keydown();
    }, 1);
}
function implement_cart_search_autocomplete() {
    var search_box = $('#cart-search');
    search_box.autocomplete({
        'minLength': 3,
        'autoFocus': true,
        'open': function () { $('ul.ui-autocomplete').css('width', 570); },
        'source': cart_search_source,
        'select': cart_search_select
    });
    search_box.data('ui-autocomplete')['_renderItem'] = cart_search_render_suggestion;
}
var cart_search_cache = {};
function cart_search_source(request, response) {
    var consoles = get_selected_console_ids();
    consoles.sort();
    var consoles_key = consoles.join(',');
    request['consoles'] = consoles_key;
    var term = request['term'];
    request['q'] = term;
    delete request['term'];
    var cache_key = term + '|' + consoles_key;
    var chosen = $('a span.js-chosen-consoles');
    if (chosen.text() === "All" || consoles.length > 90) {
        cache_key = term;
        request['consoles'] = {};
    }
    if (cache_key in cart_search_cache) {
        var data = cart_search_cache[cache_key];
        cart_handle_search_results(term, data, response);
        return;
    }
    var last_xhr;
    last_xhr = $.getJSON("/search-products?type=cart", request, function (data, status, xhr) {
        cart_search_cache[cache_key] = data;
        if (xhr === last_xhr) {
            cart_handle_search_results(term, data, response);
        }
    });
}
function cart_handle_search_results(term, data, response) {
    search_results_found(data.length);
    if (data.length == 1 && is_upc(term)) {
        response([]);
        if (needs_product_search_dropdown()) {
            var itemId = data[0].id;
            $('#pid').val(itemId);
        }
        else if (is_compare_page()) {
            var itemId = "R" + data[0].id;
            add_to_uids_list(itemId);
            submit_compare_form();
        }
        else {
            var defaultCondition = parseInt(localStorage.getItem(defaultConditionStorageKey)) || undefined;
            var item = new CartItem(data[0], defaultCondition);
            cart_add_item(item);
            $(document).trigger('cartChanged');
        }
    }
    else {
        response(data);
    }
}
function search_results_found(count) {
    var not_found = $('#cart-not-found');
    if (count > 0) {
        not_found.hide();
    }
    else {
        not_found.show()['effect']('highlight', {}, 1500);
    }
}
function cart_search_select(_event, ui) {
    if (needs_product_search_dropdown()) {
        var itemId = ui['item'].id;
        $('#pid').val(itemId);
    }
    else if (is_compare_page()) {
        var itemId = "R" + ui['item'].id;
        add_to_uids_list(itemId);
        submit_compare_form();
    }
    else {
        var defaultCondition = parseInt(localStorage.getItem(defaultConditionStorageKey)) || undefined;
        var item = new CartItem(ui['item'], defaultCondition);
        cart_add_item(item);
        $(document).trigger('cartChanged');
    }
}
function cart_add_item(item) {
    if (!VGPC.is_pro && cart_item_count() >= 10) {
        toast('Only paid subscribers can add more than 10 items.  <a href="/pricecharting-pro?f=lot-calculator" style="color: white;">Subscribe</a>');
        pricing_cart_event('10 item limit');
        return false;
    }
    item.write_to_localstorage();
    var tr = render_cart_row(item, get_markup_fn());
    $('#cart-contents tbody').prepend(tr);
    tr['effect']('highlight', {}, 1500);
    update_cart_totals();
    pricing_cart_event('Add Item');
    clear_and_focus_cart_search_box();
    return false;
}
function cart_change_condition() {
    var condition = $(this).val();
    var tr = $(this).parents('tr');
    var item = get_item_details(tr);
    item['condition'] = parseInt(condition, 10);
    var new_tr = render_cart_row(item, get_markup_fn());
    tr.replaceWith(new_tr);
    item.write_to_localstorage();
    update_cart_totals();
    pricing_cart_event('Condition to ' + condition);
    $(document).trigger('cartChanged');
}
function cart_remove_item(e) {
    e.preventDefault();
    var tr = $(this).parents('tr');
    var uuid = tr.attr('id');
    tr.fadeOut('fast', function () {
        tr.remove();
        update_cart_totals();
        $(document).trigger('cartChanged');
    });
    pricing_cart_event('Remove Item');
    localStorage.removeItem(uuid_to_localstorage_key(uuid));
    return false;
}
function cart_search_render_suggestion(ul, item) {
    var html = templates["calculator-suggestion"].render({
        product_name: item.label,
        console_name: item.console,
    });
    return $(html).data("ui-autocomplete-item", item).appendTo(ul);
}
function implement_cart_empty_button() {
    $('#cart-empty').click(function (e) {
        e.preventDefault();
        var trs = $('#cart-contents tbody tr');
        trs.each(function (_, tr) {
            var uuid = $(tr).attr('id');
            localStorage.removeItem(uuid_to_localstorage_key(uuid));
        });
        trs.fadeOut('fast', function () {
            trs.remove();
            update_cart_totals();
            clear_and_focus_cart_search_box();
            pricing_cart_event('Empty');
        });
    });
}
function implement_cart_settings() {
    var restore = function (name, onChange) {
        var vtable = cart_settings[name];
        var value = vtable['read'](preference_get('Cart' + name));
        if (value == null)
            value = vtable['default-value'];
        $('#' + name).val(vtable['show'](value))
            .data('previous-' + name, value)
            .change(onChange);
    };
    restore('SalesTaxRate', update_cart_totals);
    restore('FlatFeeMarkup', update_cart_rows);
    restore('PercentageMarkup', update_cart_rows);
    restore('PriceType', update_cart_rows);
}
function pricing_cart_event(action) {
    analytics_track_event("Tools", "Pricing Cart", action);
}
function pricingcart_tour() {
    $("#js-more-prices").click(function () {
        pricing_cart_event('See More Prices');
        $("#js-tour7").show();
    });
    $("#js-tour0").click(function () {
        pricing_cart_event('Started Tour');
        $("#js-tour0").hide();
        $("#js-tour1").show();
    });
    $("#js-tour1 > a").click(function () {
        $("#js-tour1").hide();
        $("#js-tour2").show();
    });
    $("#js-tour2 > a").click(function () {
        $("#js-tour2").hide();
        $("#js-tour3").show();
    });
    $("#js-tour3 > a").click(function () {
        $("#js-tour3").hide();
        $("#js-tour4").show();
    });
    $("#js-tour4 > a").click(function () {
        $("#js-tour4").hide();
        $("#js-tour5").show();
    });
    $("#js-tour5 > a").click(function () {
        $("#js-tour5").hide();
        $("#js-tour6").show();
    });
    $("#js-tour6 > a").click(function () {
        $("#js-tour6").hide();
        $("#js-tour7").show();
    });
    $("#js-tour7 > a").click(function () {
        $("#js-tour7").hide();
        $("#js-tour0").show();
    });
}
function uuid_to_localstorage_key(uuid) {
    return 'CartItems.' + uuid;
}
var popular_title_data;
var console_list_data;
var ga;
var gtag;
function implement_gallery_view() {
    $('.gallery_view').click(function (e) {
        e.preventDefault();
        $('#offer_list').addClass('gallery');
        localStorage["listings.wants-gallery"] = "yes";
    });
    $('.list_view').click(function (e) {
        e.preventDefault();
        $('#offer_list').removeClass('gallery');
        localStorage["listings.wants-gallery"] = "";
    });
    if (localStorage["listings.wants-gallery"]) {
        $('.gallery_view').click();
    }
}
function show_minimum_price() {
    var descendingCheckbox = $('.js-show-descending-options');
    var conf = "publish-offer.wants-descending";
    descendingCheckbox.click(function () {
        if (descendingCheckbox.is(':checked')) {
            localStorage[conf] = "yes";
            $('input[name=max-price]').attr("placeholder", "start price");
            $('.descending-price').show();
        }
        else {
            localStorage[conf] = "";
            $('input[name=max-price]').attr("placeholder", "your price");
            $('input[name=min-price]').val("");
            $('.descending-price').hide();
        }
    });
    if (localStorage[conf]) {
        descendingCheckbox.click();
        descendingCheckbox.prop('checked', true);
    }
}
function implement_recommended_price() {
    $('#js-condition-id').change(change_recommended_price);
    change_recommended_price();
}
function change_recommended_price() {
    var condition = $('#js-condition-id').val();
    if (condition == Condition.Junk) {
        condition = Condition.Loose;
    }
    var item_price = Currency.fromFloat(0);
    item_price = get_item_price(condition);
    $('.js-recommended-price').text(item_price.toString());
}
function get_item_price(cond) {
    var price_name = (Condition[cond] + '-price').toLowerCase();
    var price = $('.js-recommended-price').data(price_name);
    if (typeof price === 'undefined') {
        price = "$0";
    }
    return Currency.fromString(price);
}
function implement_search_box_autocomplete() {
    $.getJSON('/search-autocomplete', function (data) {
        popular_title_data = data;
    });
    var search_box = $('#game_search_box');
    search_box.autocomplete({
        'minLength': 3,
        'autoFocus': false,
        'delay': 150,
        'source': search_box_source,
        'select': submit_search
    });
}
function implement_search_type_drop_down() {
    $('select#search_type').change(function () {
        $('#game_search_box').focus();
    });
}
function search_box_source(request, response) {
    if (!popular_title_data)
        response([]);
    var term = request['term'].toLowerCase();
    var titles = [];
    for (var i = 0; i < popular_title_data.length; i++) {
        var title = popular_title_data[i];
        if (fuzzy_match(term, title)) {
            titles.push(title);
            if (titles.length > 4) {
                break;
            }
        }
    }
    response(titles);
}
function fuzzy_match(needle, haystack) {
    var j = -1;
    for (var i = 0; i < needle.length; i++) {
        var c = needle[i];
        if (c == ' ')
            continue;
        j = haystack.indexOf(c, j + 1);
        if (j == -1)
            return false;
    }
    return true;
}
function submit_search(event, ui) {
    var label = ui['item']['label'];
    var input = $('#game_search_box');
    input.val(label);
    var form = input.closest('form');
    form.submit();
}
function implement_filter_toggle() {
    $('.filters .head').click(function (e) {
        e.preventDefault();
        $('div#more-filters').toggle();
        $('.share_it div').toggle();
        var opts = $('.filters p a.options');
        if (opts.text() === "+") {
            opts.text('-');
        }
        else {
            opts.text('+');
        }
    });
    $('.js-search-form #toggle-inputs').click(function (e) {
        var height = $('.js-search-form').height();
        if (height > 40) {
            $('.js-search-form #toggle-inputs').text("∨");
            $('.js-search-form').css('height', '32px');
        }
        else {
            $('.js-search-form #toggle-inputs').text("∧");
            $('.js-search-form').css('height', 'auto');
        }
    });
}
function implement_share_it_toggle() {
    $('.share_it .head').click(function (e) {
        e.preventDefault();
        $('.share_it div').toggle();
        var opts = $('.share_it a.options');
        if (opts.text() === "+") {
            opts.text('-');
        }
        else {
            opts.text('+');
        }
    });
}
function implement_dialogs() {
    var hash = window.location.hash.substring(1);
    if (hash.length > 0) {
        show_dialog(hash, '');
    }
    $('.js-show-dialog').click(function (e) {
        e.preventDefault();
        var target = $(e.target);
        var dialog_name = target.data('which-dialog');
        var video_id = target.data('youtube-id');
        show_dialog(dialog_name, video_id);
    });
}
function show_dialog(name, video_id) {
    if (name === "video") {
        var src = "https://www.youtube.com/embed/" + video_id + "?rel=0";
        $('#js-dialog-video iframe').attr('src', src);
    }
    $('#js-dialog-' + name).dialog({
        position: { my: "top", at: "top+30", of: window },
        modal: true,
        minWidth: 320,
    });
}
function show_dialog_with_title(name, title) {
    $('#js-dialog-' + name).dialog({
        position: { my: "top", at: "top+30", of: window },
        modal: true,
        minWidth: 360,
        title: title,
    });
}
function implement_tricky_analytics() {
}
function want_to_see_tour(name) {
    if (localStorage[name] == "true") {
        return;
    }
    show_dialog('take-tour', '');
    localStorage[name] = "true";
    $('.js-start-tour').click(function (e) {
        $('#js-dialog-take-tour').dialog('close');
        $("#js-tour0").trigger('click');
    });
    $('.js-close').click(function (e) {
        $('#js-dialog-take-tour').dialog('close');
        e.preventDefault();
    });
}
function implement_usability_tip(first, second) {
    if (localStorage[first] == "seen") {
        if (typeof second === 'undefined') {
            return;
        }
        else {
            if (localStorage[second] == "seen") {
                return;
            }
            else {
                var tipName = "#js-usability-" + second;
                $(tipName).show();
                $(tipName + ' .js-close').click(function (e) {
                    localStorage[second] = "seen";
                    $(tipName).hide();
                    e.preventDefault();
                });
            }
        }
    }
    else {
        var tipName = "#js-usability-" + first;
        $(tipName).show();
        $(tipName + ' .js-close').click(function (e) {
            localStorage[first] = "seen";
            $(tipName).hide();
            e.preventDefault();
        });
    }
}
function implement_add_to_collection() {
    $('.js-addable').on('click', '.js-add-one-click', function (e) {
        e.preventDefault();
        var id = $(this).data('product-id');
        if (id === null) {
            return;
        }
        var ok = add_to_collection(id);
        if (!ok) {
            return;
        }
        change_wishlist_button_to_removed($(this));
        var li = $(this).closest('li.add_to.collection');
        li.html("" +
            "<a href='/my-collection?product=" + id + "' class='orange button small'>" +
            "in<span class='small-desktop-hidden'> Collection</span>" +
            "</a>");
    });
    $('#game-page li.add_to.collection').on('click', '.js-add-one-click', function (e) {
        e.preventDefault();
        var id = $(this).data('product-id');
        if (id === null) {
            return;
        }
        var ok = add_to_collection(id);
        if (!ok) {
            return;
        }
        change_wishlist_button_to_removed($(this));
        var li = $(this).closest('li.add_to.collection');
        li.html("<a href='/my-collection?product=" + id + "' class='orange button small'>In Collection</a>");
        $('#game_search_box').focus();
    });
}
function add_to_collection(id) {
    if (VGPC.user_id === "") {
        alert("You must be logged in to add to a collection");
        return false;
    }
    var defaultCondition = preference_get('DefaultCondition') || "1";
    var url = VGPC.www_url + "/api/offer-publish?product=" + id + "&add-to-collection=on&max-price=0&condition-id=" + defaultCondition;
    var category = VGPC.category || 'search';
    var page = '/publish-offer/one-click/' + category;
    gtag('config', ga4_tag_id, { page_location: page });
    $.ajax({
        method: 'POST',
        url: url,
        error: function (request, status, error) {
            console.log(request.responseText);
        }
    });
    return true;
}
function implement_bid_changes() {
    $('#active, #active .meta-watchtower').on('change', 'tr.item, tr.item-details', function () {
        var row = $(this);
        var data = {};
        row.find('input:visible, select:visible').each(function () {
            var el = $(this);
            var name = $(this).attr('name');
            var value;
            if (el.is(':checkbox')) {
                value = el.prop('checked');
            }
            else {
                value = el.val();
            }
            if (name) {
                data[name] = value;
            }
        });
        data["bid-id"] = $(row).find('input[name="bid-id"]').val();
        $.ajax({
            url: '/api/update-wishlist',
            method: 'POST',
            data: data,
            success: function (response) {
                analytics_track_event('Tools', 'Wishlist', 'Change Details');
            },
            error: function (err) {
                console.error('Wishlist update failed: ', err);
            }
        });
    });
}
function implement_toggle_bid() {
    $('#active').on('click', 'tr.item .js-expand-bid', function () {
        var clickedRow = $(this).closest('tr.item');
        clickedRow.css('background-color', '#ddd');
        var detailsRow = clickedRow.nextAll('tr.item-details').first();
        detailsRow.show();
        $(this).hide();
        clickedRow.find('.js-shrink-bid').show();
    });
    $('#active').on('click', 'tr.item .js-shrink-bid', function () {
        var clickedRow = $(this).closest('tr.item');
        clickedRow.css('background-color', '');
        var detailsRow = clickedRow.nextAll('tr.item-details').first();
        detailsRow.hide();
        $(this).hide();
        clickedRow.find('.js-expand-bid').show();
    });
}
function implement_cancel_bid() {
    $('.selling_table').on('click', '.js-cancel-bid', function (e) {
        e.preventDefault();
        var button = $(e.target);
        var tr = button.closest('tr');
        var bidId = tr.data('id');
        if (bidId === null) {
            return;
        }
        var ok = cancel_from_wishlist(bidId);
        if (!ok) {
            return;
        }
        change_wishlist_button_to_removed($(this));
    });
    $('.js-addable').on('click', '.js-cancel-bid', function (e) {
        e.preventDefault();
        var button = $(e.target);
        var ul = button.closest('ul');
        var productId = ul.data('product-id');
        if (productId === null) {
            return;
        }
        var ok = cancel_from_wishlist_all_by_product(productId);
        if (!ok) {
            return;
        }
        change_wishlist_button_to_removed($(this));
    });
    $('#game-page li.add_to.wishlist').on('click', '.js-cancel-bid', function (e) {
        e.preventDefault();
        var productId = VGPC.product.id;
        if (productId === null) {
            return;
        }
        var ok = cancel_from_wishlist_all_by_product(productId);
        if (!ok) {
            return;
        }
        change_wishlist_button_to_removed($(this));
    });
}
function cancel_from_wishlist(bidId) {
    if (VGPC.user_id === "") {
        alert("You must be logged in to remove from a wishlist");
        return false;
    }
    $.post("/api/remove-wishlist", { bidId: bidId });
    gtag('config', ga4_tag_id, { page_location: '/wishlist-remove/one-click' });
    return true;
}
function cancel_from_wishlist_all_by_product(productId) {
    if (VGPC.user_id === "") {
        alert("You must be logged in to remove from a wishlist");
        return false;
    }
    $.post("/api/remove-wishlist-product", { product: productId });
    gtag('config', ga4_tag_id, { page_location: '/wishlist-remove/one-click' });
    return true;
}
function change_wishlist_button_to_removed(clicked) {
    if (is_console_price_page() || is_price_search_results_page()) {
        var td = clicked.closest('.add_to.container');
        var li = td.find('li.add_to.wishlist');
        li.html("<span class='blue button small js-add-bid'>&#43;<span class='small-desktop-hidden'> Wishlist</a></span></span>");
        var dropdown = td.find('li.js-in-wishlist');
        dropdown.html("<a href='#' class='js-add-bid'>&#43; Wishlist</a>");
        dropdown.removeClass("js-in-wishlist");
        var nextElement = dropdown.next();
        if (nextElement.find('a.js-cancel-bid').length) {
            nextElement.remove();
        }
        var span = dropdown.closest('li.add_to').find('span.blue');
        span.removeClass('orange');
    }
    else if (is_pricing_game_page()) {
        var ul = clicked.closest('ul.add_to');
        var li = ul.find('li.add_to.wishlist');
        li.html("<span class='blue button small js-add-bid'>&#43; Wishlist</span>");
    }
    else if (is_wishlist_page()) {
        var clickedTr = clicked.closest('tr');
        var id = clickedTr.data('id');
        var productTr = $("#bid-" + id);
        productTr.hide(100);
        clickedTr.closest('tr.item-details').hide();
    }
}
function implement_add_bid() {
    $('.js-addable').on('click', '.js-add-bid', function (e) {
        e.preventDefault();
        var button = $(e.target);
        var ul = button.closest('ul');
        var product = ul.data('product-id');
        if (product === null) {
            return;
        }
        var ok = add_to_wishlist(product);
        if (!ok) {
            return;
        }
        var li = $(this).closest('li.add_to.wishlist');
        li.html("<span class='orange button small js-cancel-bid' title='clicking removes from wishlist'>in Wishlist</span>");
        var dropdown = $(this).closest('li.list-item');
        dropdown.addClass("js-in-wishlist");
        dropdown.html("<a href='#' class='js-add-bid'>+ Wishlist Another</a>");
        var nextElement = dropdown.next();
        if (!nextElement.find('a.js-cancel-bid').length) {
            dropdown.after("<li class='list-item'><a href='#' class='js-cancel-bid'>- Wishlist</a></li>");
        }
        var span = dropdown.closest('li.add_to').find('span.blue');
        span.addClass('orange');
    });
    $('#game-page li.add_to.wishlist').on('click', '.js-add-bid', function (e) {
        e.preventDefault();
        var product = VGPC.product.id;
        if (product === null) {
            return;
        }
        var ok = add_to_wishlist(product);
        if (!ok) {
            return;
        }
        var li = $(this).closest('li.add_to.wishlist');
        li.html("<span class='orange button small js-cancel-bid' title='clicking removes from wishlist'>in Wishlist</span>");
    });
}
function add_to_wishlist(product) {
    if (VGPC.user_id === "") {
        alert("You must be logged in to add to a wishlist");
        return false;
    }
    var category = VGPC.category || 'search';
    var page = '/wishlist-add/one-click/' + category;
    gtag('config', ga4_tag_id, { page_location: page });
    $.post("/api/add-wishlist", { product: product });
    return true;
}
function implement_region_filtered_dropdown() {
    $('select#region').change(function () {
        var region = $(this).children("option:selected").val();
        $('.regionChange').each(function () {
            if ($(this).hasClass('region0')) {
            }
            else if ($(this).hasClass(region)) {
                $(this).show();
            }
            else {
                $(this).hide();
            }
        });
    });
}
function implement_console_filter_autocomplete() {
    if (!VGPC.category) {
        return false;
    }
    var uri = "/consoles-autocomplete/" + VGPC.category;
    $.getJSON(uri, function (data) {
        console_list_data = data;
    });
    var search_box = $('#js-consoles-list-input');
    search_box.autocomplete({
        'autoFocus': false,
        'source': console_filter_source,
        'select': submit_console_filter
    });
}
function console_filter_source(request, response) {
    if (!console_list_data)
        response([]);
    var term = request['term'].toLowerCase();
    var titles = [];
    var length = Object.keys(console_list_data).length;
    for (var i = 0; i < length; i++) {
        var title = console_list_data[i]['label'];
        var uid = console_list_data[i]['value'];
        if (fuzzy_match(term, title)) {
            var x = {
                "label": title,
                "value": uid,
            };
            titles.push(x);
            if (titles.length > 100) {
                break;
            }
        }
    }
    response(titles);
}
function submit_console_filter(event, ui) {
    var label = ui['item']['label'];
    var value = ui['item']['value'];
    if (value === 'all') {
        value = '';
    }
    $('#js-console-uid').val(value);
    if (typeof value != 'undefined') {
        $('.offers_nav').find('form').submit();
        $('form.js-search-form').submit();
        $('#js-console-by-uid').submit();
        if (is_compare_page()) {
            var itemId = value.replace('G', 'C');
            add_to_uids_list(itemId);
            submit_compare_form();
        }
        if (is_snipe_page()) {
            snipe_console_chosen_from_autocomplete(value, label);
            event.preventDefault();
            $('#js-consoles-list-input').val('');
        }
    }
}
function snipe_console_chosen_from_autocomplete(consoleUid, consoleName) {
    var consoleId = consoleUid.substring(1, consoleUid.length);
    var set = $('#console_' + consoleId);
    var selected = $('#console-groups li.selected');
    if (selected.length > 50) {
        $('#select-none').trigger('click');
    }
    $(set).addClass('selected');
    var chosen = $('.js-chosen-consoles');
    update_chosen_text(chosen);
}
function implement_console_search_cleared() {
    $('#js-consoles-list-input').change(function () {
        var inputVal = $(this).val();
        if (inputVal === "" || inputVal === undefined) {
            $('#js-console-uid').val('');
        }
    });
}
function implement_color_theme() {
    $("#color-theme").click(function (e) {
        if ($("#color-theme").prop('checked') == true) {
            createCookie("color_theme", "dark", 5000);
            $("<link/>", {
                rel: "stylesheet",
                type: "text/css",
                id: "js-dark-css",
                href: "/css/dark.css"
            }).appendTo("head");
        }
        else {
            eraseCookie("color_theme");
            $("#js-dark-css").remove();
        }
    });
}
function implement_permission_redirect() {
    var permissionUrl = $("#js-redirect-url").attr("href");
    if (permissionUrl) {
        window.location.href = permissionUrl;
    }
}
function implement_add_missing_sale_ajax() {
    $("#add-missing").submit(function (event) {
        event.preventDefault();
        var formData = $(this).serialize();
        var resElem = $("#add-missing-response");
        resElem.text("");
        resElem.removeClass();
        $.ajax({
            type: "POST",
            url: "/api/add-new-listings",
            data: formData,
            dataType: "json",
            success: function (response) {
                if (response.message) {
                    resElem.text(response.message);
                    resElem.addClass("success");
                }
                else {
                    resElem.text("Unexpected response format.");
                }
            },
            error: function (xhr) {
                var errorResponse = xhr.responseJSON;
                if (errorResponse && errorResponse.error) {
                    resElem.text(errorResponse.error);
                }
                else {
                    resElem.text("Error adding listing");
                }
                resElem.addClass("fail");
            }
        });
        $("#add-missing-response").show();
        $(this).find('input[name="listingId"]').val("");
    });
}
function implement_folder_edit_name() {
    $('input[name="folder-name"]').on('change', function () {
        var folderDiv = $(this).closest('.folder');
        var formData = folderDiv.find(':input').serialize();
        var errMsgElem = folderDiv.find('.error-message');
        var succMsgElem = folderDiv.find('span.check_mark');
        errMsgElem.hide();
        succMsgElem.hide();
        $.ajax({
            url: '/api/folders-edit',
            method: 'POST',
            data: formData,
            dataType: "json",
            success: function (response) {
                if (response.status === 'error') {
                    errMsgElem.text(response['error']).show();
                }
                else {
                    succMsgElem.show();
                }
            },
            error: function (xhr) {
                var errorResponse = xhr.responseJSON;
                if (errorResponse && errorResponse.error) {
                    errMsgElem.text(errorResponse.error);
                }
                else {
                    errMsgElem.text("Error adding listing");
                }
                errMsgElem.show();
            }
        });
    });
    $('input[name="folder-name"]').on('focus', function () {
        var errMsgElem = $(this).find('.error-message');
        var succMsgElem = $(this).find('span.check_mark');
        errMsgElem.hide();
        succMsgElem.hide();
    });
}
function implement_folder_add() {
    $('#js-new-folder').submit(function (event) {
        event.preventDefault();
        var formElem = $(this);
        var formData = $(this).serialize();
        var folderName = $(this).find('input[name="new-folder-name"]').val();
        var errMsgElem = formElem.find('.error-message');
        var succMsgElem = formElem.find('span.check_mark');
        errMsgElem.hide();
        succMsgElem.hide();
        $.ajax({
            type: "POST",
            url: "/api/folders-add",
            data: formData,
            dataType: "json",
            success: function (response) {
                if (response.status === 'error') {
                    errMsgElem.text(response['error']).show();
                }
                else {
                    succMsgElem.show();
                    $('#new-folders-list').prepend('<li>' + folderName + '</li>');
                    $('#refresh-list').show();
                    $('#new-folders-list-container').show();
                }
            },
            error: function (xhr) {
                var errorResponse = xhr.responseJSON;
                if (errorResponse && errorResponse.error) {
                    errMsgElem.text(errorResponse.error);
                }
                else {
                    errMsgElem.text("Error adding folder");
                }
                errMsgElem.show();
            }
        });
        $(this).find('input[name="new-folder-name"]').val("");
    });
}
var linesArray = [];
var intervalID = -1;
var countDown = 3.00;
var fillCharInterval = 0.06;
var noiseInterval = 0.01;
var realInterval = 0.01;
var idOfElement = null;
var origChar = [];
function implement_word_scramble() {
    if ($('.terminal span.wrong').length) {
        return;
    }
    if ($('.sneakers').length) {
        countDown = 5.00;
    }
    scramble('.terminal p');
    unscramble('.terminal p');
}
function scramble(__id) {
    linesArray = $(__id).html().split('<br>');
    $(__id).empty();
    for (var i = 0; i < linesArray.length; i++) {
        var chunk = linesArray[i];
        for (var j = 0; j < chunk.length; j++) {
            var chunkUni = chunk[j].charCodeAt(0);
            if (chunkUni == 10) {
            }
            else if (chunkUni != 32) {
                origChar.push(chunk[j]);
                $(__id).append('<span>' + randomLetter() + '</span>');
            }
            else {
                origChar.push(' ');
                $(__id).append('<span> </span>');
            }
        }
        $(__id).append('<br>');
    }
}
;
function unscramble(__id) {
    if (intervalID == -1) {
        idOfElement = $(__id);
        intervalID = window.setInterval(unscrambleChar, 1);
    }
    else {
        window.clearInterval(intervalID);
        intervalID = -1;
    }
}
;
function randomLetter() {
    return String.fromCharCode(Math.floor(((Math.random() * 1000) % 42) + 49));
}
;
function unscrambleChar() {
    var spans = $('span', $(idOfElement));
    countDown -= 0.005;
    realInterval += 0.01;
    noiseInterval += 0.003;
    var charIndex = Math.floor(((Math.random() * 1000) * 1000) % origChar.length);
    if (countDown <= 0) {
        window.clearInterval(intervalID);
        intervalID = -1;
        for (var i = 0; i < spans.length; i++) {
            $(spans[i]).text(origChar[i]);
        }
    }
    if (noiseInterval >= 0.003) {
        var ch = $(spans[charIndex]).text();
        if (ch != '' && ch != origChar[charIndex]) {
            $(spans[charIndex]).text(randomLetter());
        }
        noiseInterval = 0.00;
    }
    if (realInterval >= fillCharInterval) {
        var ch = $(spans[charIndex]).text();
        if (ch != '' && ch != origChar[charIndex]) {
            $(spans[charIndex]).text(origChar[charIndex]);
        }
        realInterval = 0.00;
    }
}
;
function implement_photo_switching() {
    var options = {
        responsive: true,
        zoomType: "lens",
        lensShape: "round",
        lensSize: 300
    };
    var primary = $('.primary img');
    if (primary.length == 0)
        return;
    $('.secondary img').hover(function () {
        var img = $('.primary img');
        img.attr('src', $(this).data('medium-src'));
        img.data('zoom-image', $(this).data('zoom-src'));
        $('.primary a').attr('href', $(this).data('zoom-src'));
        img.elevateZoom(options);
    });
    if ($(window).width() > 500) {
        primary.elevateZoom(options);
    }
}
var Offers;
(function (Offers) {
    var UserViewing = (function () {
        function UserViewing() {
        }
        return UserViewing;
    }());
    UserViewing.OwnOffers = "OwnOffers";
    UserViewing.Purchases = "Purchases";
    UserViewing.Offers = "Offers";
    UserViewing.Collection = "Collection";
    UserViewing.Wishlist = "Wishlist";
    var is_fetching_more_pages;
    var viewMode;
    function implement_infinite_scrolling() {
        var offers = $('.js-offers');
        if (offers.length > 0) {
            viewMode = offers.data('user-viewing');
            $(window).on('scroll', on_scroll);
        }
    }
    Offers.implement_infinite_scrolling = implement_infinite_scrolling;
    function on_scroll() {
        if (is_fetching_more_pages)
            return;
        var win = $(window);
        if (win.scrollTop() + window.innerHeight >= win.height() - 700) {
            fetch_next();
        }
    }
    function fetch_next() {
        is_fetching_more_pages = true;
        var form = $('.offers-paging form.next_page');
        if (form.length == 0) {
            infinite_scrolling_is_done();
            return;
        }
        var loc = window.location;
        var url = loc.protocol + '//' + loc.host + loc.pathname + loc.search;
        if (loc.search == '') {
            url += "?" + form.serialize();
        }
        else {
            url += "&" + form.serialize();
        }
        $.get(url, { 'internal': 'true' }, next_available, "json");
    }
    function infinite_scrolling_is_done() {
        $(window).unbind('scroll', on_scroll);
        $('.js-offers .offers-paging').remove();
    }
    function next_available(data) {
        var input = $('.js-offers .offers-paging input[name=cursor]');
        displayData(data);
        var cursor = data.cursor;
        if (cursor) {
            input.val(cursor);
        }
        else {
            infinite_scrolling_is_done();
        }
        is_fetching_more_pages = false;
    }
    function displayData(data) {
        switch (viewMode) {
            case UserViewing.OwnOffers:
                getNewOwnOffer(data);
                break;
            case UserViewing.Offers:
                getNewOffer(data);
                break;
            case UserViewing.Purchases:
                getNewPurchaseOffer(data);
                break;
            case UserViewing.Collection:
                getNewCollection(data);
                break;
            case UserViewing.Wishlist:
                getNewWishlist(data);
                break;
        }
    }
    function getNewOwnOffer(data) {
        var tbody = $('.js-offers .selling_table');
        var paging = tbody.find('tr.offers-paging').first();
        for (var _i = 0, _a = data.offers; _i < _a.length; _i++) {
            var offer = _a[_i];
            var html = templates["offers-seller-item"].render(offer);
            $(html).insertBefore(paging);
        }
    }
    function getNewPurchaseOffer(data) {
        var tbody = $('.js-offers .buying_table');
        var paging = tbody.find('tr.offers-paging').first();
        for (var _i = 0, _a = data.offers; _i < _a.length; _i++) {
            var offer = _a[_i];
            var html = templates["offers-buyer-item"].render(offer);
            $(html).insertBefore(paging);
        }
    }
    function getNewCollection(data) {
        var tbody = $('.js-offers .selling_table');
        var paging = tbody.find('tr.offers-paging').first();
        for (var _i = 0, _a = data.offers; _i < _a.length; _i++) {
            var offer = _a[_i];
            var html = templates["offers-collection-item"].render(offer);
            $(html).insertBefore(paging);
        }
    }
    function getNewWishlist(data) {
        var tbody = $('.js-offers .selling_table');
        var paging = tbody.find('tr.offers-paging').first();
        for (var _i = 0, _a = data.bids; _i < _a.length; _i++) {
            var bid = _a[_i];
            var html = templates["wishlist-item"].render(bid);
            $(html).insertBefore(paging);
        }
    }
    function getNewOffer(data) {
        var tbody = $('.js-offers .product_table');
        var row = tbody.find('tr').first();
        var gap = tbody.find('tr.gap').first();
        var resultType = tbody.find('.js-offers .result-type').val();
        var isSingleProduct = resultType == "singleProduct";
        for (var _i = 0, _a = data.offers; _i < _a.length; _i++) {
            var offer = _a[_i];
            offer.isSingleProduct = isSingleProduct;
            var html = templates["offers-item"].render(offer);
            tbody.append(html);
        }
    }
    function implement_change_offer_tags() {
        var after = '';
        $('#active').on('change', 'tr.offer', function () {
            after = generate_condition_id_string(this);
            var id = $(this).data('offer-id');
            var selected = $(this).find('#js-folder').val();
            if (selected === '-new-folder') {
                window.open('/publish-offer?offer-id=' + id + "&add-to-collection=1#set-folder", '_blank');
                return;
            }
            var url = VGPC.www_url + "/api/offer-publish?offer-id=" + id + "&add-to-collection=on&max-price=0" + after;
            $.ajax({
                method: 'POST',
                url: url,
                error: function (request, status, error) {
                    console.log(request.responseText);
                }
            });
            gtag('config', ga4_tag_id, { page_location: '/publish-offer/change-includes' });
        });
    }
    Offers.implement_change_offer_tags = implement_change_offer_tags;
    function generate_condition_id_string(tr) {
        var tagsStr = '';
        var conditionId = $(tr).find('#js-condition-id').val();
        tagsStr = tagsStr + "&condition-id=" + conditionId;
        var cost = $(tr).find('#js-cost').val();
        tagsStr = tagsStr + "&cost-basis" + "=" + cost;
        var quantity = $(tr).find('#js-quantity').val();
        tagsStr = tagsStr + "&quantity" + "=" + quantity;
        var folder = $(tr).find('#js-folder').val();
        if (folder) {
            tagsStr = tagsStr + "&folder-id" + "=" + encodeURIComponent(folder);
        }
        return tagsStr;
    }
})(Offers || (Offers = {}));
var ga4_tag_id = "G-453H69Q4EC";
if (window.location.hostname.indexOf("sportscardspro.com") !== -1) {
    ga4_tag_id = "G-Y8N04S4L7H";
}
$(function () {
    ensure_preferences_synced(do_nothing);
    implement_gallery_view();
    implement_search_box_autocomplete();
    implement_search_type_drop_down();
    implement_console_filter_autocomplete();
    implement_console_search_cleared();
    SearchByPhoto.init();
    if (is_price_search_results_page()) {
        implement_sticky_headers();
        implement_usability_tip('search-category');
    }
    implement_filter_toggle();
    implement_share_it_toggle();
    implement_dialogs();
    implement_tricky_analytics();
    implement_faq();
    implement_add_to_collection();
    implement_add_bid();
    implement_cancel_bid();
    display_admin_charts();
    Offers.implement_infinite_scrolling();
    implement_hoverable_question_icons();
    implement_upc_scanner();
    implement_color_theme();
    if (should_include_pageview_tracking()) {
        LocalData.updatePageView(VGPC.console_uid);
    }
    if (page_matches("^/game/")) {
        implement_add_missing_sale_ajax();
    }
    if (page_matches("^/add-product")) {
        $(window).bind("pageshow", function () {
            var existingSet = $("#js-consoles-list-input").val();
            $("#js-console-uid").val(existingSet);
        });
    }
    if (is_publish_offer_page()) {
        implement_photo_inputs();
        implement_listing_validation();
        implement_fee_calculation();
        implement_recommended_price();
        show_minimum_price();
        implement_publish_offer_suggestions();
        mark_image_for_deletion();
    }
    if (page_matches("^/change-customguide-column") || page_matches("^/add-product") || page_matches("^/add-collection-pics")) {
        implement_photo_inputs();
        mark_image_for_deletion();
        implement_region_filtered_dropdown();
    }
    if (page_matches("^/edit-profile")) {
        implement_photo_inputs();
    }
    if (page_matches("^/card-centering-calculator")) {
        render_card_centering_debug_chart();
    }
    if (is_zombie_game_page()) {
        implement_zombie_game();
    }
    if (page_matches("^/priceit/")) {
        implement_priceit_game();
    }
    if (is_paypal_connect_page()) {
        implement_permission_redirect();
    }
    if (is_offer_page()) {
        implement_photo_switching();
        return;
    }
    if (is_offers_page()) {
        Offers.implement_change_offer_tags();
        if (is_collection_page()) {
            implement_end_offer();
            implement_confirm_end_offer();
            if (!is_collection_product_page()) {
                render_collection_price_chart();
                show_collection_grade_tooltip();
                show_collection_change_tooltip();
            }
        }
        return;
    }
    if (is_collection_dash()) {
        render_collection_price_chart();
        convert_dashboard_price_data();
        return;
    }
    if (is_pricing_game_page()) {
        implement_tabs();
        implement_compare_prices_tracking();
        implement_sales_details();
        convert_game_price_chart_data();
        implement_typical_shipping_button();
        implement_show_chart_on_mobile();
        implement_sort_sales_by_heading();
        implement_usability_tip('game-historicSales', 'game-addCollection');
        show_sale_photo_tooltip();
        render_pop_chart();
        filter_ungraded_sales_on_change();
        filter_ungraded_sales_on_load();
        return;
    }
    if (is_console_price_page()) {
        implement_infinite_scrolling_console_page();
        implement_usability_tip('console-excludeVariant');
        implement_sticky_headers();
        invert_sort_price();
        render_console_price_chart();
        return;
    }
    if (is_settings_page()) {
        implement_default_condition_change();
        ensure_preferences_synced(do_nothing);
        implement_show_default_condition();
        return;
    }
    if (is_wishlist_page()) {
        implement_bid_changes();
        implement_toggle_bid();
    }
    if (is_snipe_page()) {
        implement_bin_sniping();
    }
    if (is_lot_calculator_page()) {
        implement_lot_calculator();
    }
    if (is_ebay_lot_page()) {
        implement_ebay_lot_page();
    }
    if (is_pricecharting_pro_page()) {
        implement_pricecharting_pro();
    }
    if (is_compare_page()) {
        render_compare_price_chart();
        implement_cart_search_autocomplete();
        implement_remove_uid();
    }
    if (page_matches("^/download-price-guide/")) {
        implement_download_price_guide();
    }
    if (page_matches("^/subscriptions")) {
        implement_price_guides_page();
    }
    if (page_matches("^/folders")) {
        implement_folder_edit_name();
        implement_folder_add();
    }
    if (is_collection_text_importer()) {
        implement_full_details_toggle();
        implement_collection_text_importer();
    }
    if (is_centering_calculator()) {
        implement_card_centering_resize();
        implement_card_chosen();
    }
    if (is_big_movers()) {
        implement_usability_tip('bigmovers-sort');
    }
    if (is_psa_scraper() || is_ebay_scraper() || is_ngc_scraper()) {
        implement_full_details_toggle();
    }
    if (needs_product_search_dropdown()) {
        implement_console_selection_widget({
            maximum_consoles_to_render: 5,
            display_method: 1,
            retain_selected_consoles: true
        });
        implement_cart_search_autocomplete();
    }
    if (is_puzzle_page()) {
        implement_word_scramble();
    }
    if (is_add_listings_page()) {
        window.onscroll = function () { fixed_header(); };
        var header = document.getElementById("add-data");
        var sticky = header.offsetTop;
        function fixed_header() {
            if (window.pageYOffset > sticky) {
                header.classList.add("sticky");
            }
            else {
                header.classList.remove("sticky");
            }
        }
    }
});
function page_matches(pattern) {
    if (!!window.location.pathname.match(pattern)) {
        return true;
    }
    if (!!window.location.search.match(pattern)) {
        return true;
    }
    return false;
}
function page_is(pattern) {
    if (window.location.pathname === pattern) {
        return true;
    }
    return false;
}
function is_pricing_game_page() {
    return page_matches("/game/");
}
function is_publish_offer_page() {
    return page_matches("^/publish-offer");
}
function is_snipe_page() {
    return page_matches("^/snipe");
}
function is_settings_page() {
    return page_matches("/settings");
}
function is_lot_calculator_page() {
    return page_matches("^/lot-value-calculator");
}
function is_ebay_lot_page() {
    return page_matches("^/lot/") || page_matches("^/ebay-lot-bot");
}
function is_pricecharting_pro_page() {
    return page_matches("^/pricecharting-pro") || page_matches("^/sportscardspro-premium");
}
function is_compare_page() {
    return page_matches("^/compare");
}
function is_collection_text_importer() {
    return page_matches("^/collection-text-importer");
}
function is_centering_calculator() {
    return page_matches("^/card-centering-calculator");
}
function is_psa_scraper() {
    return page_matches("^/admin/psa-scrape");
}
function is_ngc_scraper() {
    return page_matches("^/admin/ngc-scrape");
}
function is_ebay_scraper() {
    return page_matches("^/admin/ebay-scraper");
}
function is_big_movers() {
    return page_matches("^/big-movers");
}
function is_puzzle_page() {
    return page_matches("^/puzzle/");
}
function is_paypal_connect_page() {
    return page_matches("^/paypal-connect");
}
function is_offer_page() {
    return page_matches("^/offer/");
}
function is_offers_page() {
    return page_matches("^/offers");
}
function is_console_price_page() {
    return page_matches("/console/");
}
function is_category_page() {
    return page_matches("/category/");
}
function is_collection_page() {
    return page_matches("status=collection");
}
function is_collection_product_page() {
    return page_matches("product=");
}
function is_collection_dash() {
    return page_matches("/collection-dash");
}
function is_add_listings_page() {
    return page_matches("/ebay/add-new-listings");
}
function is_modify_sale_page() {
    return page_matches("/ebay/modify-sale") || page_matches("/ebay/modify-orphan-sale");
}
function is_add_sale_page() {
    return page_matches("/add-new-sale");
}
function is_add_variant_page() {
    return page_matches("/admin/add-variant");
}
function needs_product_search_dropdown() {
    if (is_add_listings_page() || is_modify_sale_page() || is_add_variant_page() || is_add_sale_page()) {
        return true;
    }
    else {
        return false;
    }
}
function is_price_search_results_page() {
    if (page_matches("^/search-products")) {
        if (page_matches("type=prices")) {
            return true;
        }
    }
    return false;
}
function is_zombie_game_page() {
    if (is_pricing_game_page() || is_console_price_page() || is_category_page()) {
        return false;
    }
    else {
        return false;
    }
}
function is_wishlist_page() {
    return page_matches("^/wishlist");
}
function should_include_pageview_tracking() {
    if (typeof VGPC !== 'undefined') {
        if (typeof VGPC.console_uid !== 'undefined') {
            return true;
        }
    }
    return false;
}
function implement_hoverable_question_icons() {
    $('a.js-info').click(function (e) { e.preventDefault(); });
    $('img.js-info').hover(function (e) {
        var target = $(e.target);
        var cell = target.closest('.cell');
        var more_info = cell.find('.more_info');
        if (more_info.hasClass('hidden')) {
            var column_name = cell.attr('id') || 'unknown';
            analytics_track_event('PriceGuide', 'Info_Hover', column_name);
        }
        more_info.toggleClass('hidden');
    });
}
function do_nothing() {
    return;
}
var prefs_url = "/preferences";
function store(key, value) {
    localStorage[key] = value;
}
;
function retrieve(key) {
    return localStorage[key];
}
;
function remove(key) {
    delete localStorage[key];
}
;
function storage_keys() {
    var len = localStorage.length;
    var keys = [];
    for (var i = 0; i < len; i++) {
        keys.push(localStorage.key(i));
    }
    return keys;
}
;
function preference_set(key, value) {
    $.post(prefs_url, { key: key, value: value });
    store('prefs.' + key, value);
}
function preference_get(key) {
    return retrieve('prefs.' + key);
}
function ensure_preferences_synced(callback) {
    if (VGPC.user_id === "" || VGPC.user_id === undefined) {
        return;
    }
    if (is_cached_preferences_stale()) {
        sync_preferences(callback);
    }
    else {
        callback();
    }
}
function sync_preferences(callback) {
    $.ajax({
        'url': prefs_url,
        'dataType': 'json',
        'cache': false,
        xhrFields: {
            withCredentials: true
        },
        'success': function (prefs) {
            clear_preferences();
            var expires = (new Date()).getTime() + 86400000;
            var keys = hashKeys(prefs);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var value = prefs[key];
                if (key == "expires" && value > 0 && value < expires) {
                    expires = value;
                }
                else {
                    if (typeof (value) == "object") {
                        value = JSON.stringify(value);
                    }
                    store('prefs.' + key, value);
                }
            }
            store('prefs.expires', expires);
            if (callback) {
                callback();
            }
        }
    });
}
function is_cached_preferences_stale() {
    var expires = parseInt(retrieve('prefs.expires') || "0", 10);
    var now = (new Date()).getTime();
    if (now > expires)
        return true;
    return false;
}
function clear_preferences() {
    var keys = storage_keys();
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.match('^prefs[.]'))
            remove(key);
    }
}
function implement_pricecharting_pro() {
    $('.js-stripe-payment-button').click(on_click_collector_subscribe_button);
    $('.js-stripe-payment-button-year').click(on_click_collector_year_button);
    $('.js-stripe-payment-button-retail').click(on_click_legendary_subscribe_button);
    $('.js-stripe-payment-button-retail-year').click(on_click_legendary_year_button);
    show_feature_descriptions();
    show_more_features();
}
function on_click_collector_subscribe_button(e) {
    console.log("DEBUG on_click_collector_subscribe_button");
    e.preventDefault();
    var form = $('.js-stripe-payment-button-retail').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-retail-year').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-year').closest("form");
    form.attr("id", "");
    var form = $('.js-stripe-payment-button').closest("form");
    form.attr("id", "js-submitted");
    analytics_track_event('PricechartingPro', 'Clicked_Purchase', 'Pro');
    trigger_stripe_payment_request();
}
function on_click_legendary_subscribe_button(e) {
    console.log("DEBUG on_click_legendary_subscribe_button");
    e.preventDefault();
    var form = $('.js-stripe-payment-button').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-year').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-retail-year').closest("form");
    form.attr("id", "");
    var form = $('.js-stripe-payment-button-retail').closest("form");
    form.attr("id", "js-submitted");
    analytics_track_event('PricechartingPro', 'Clicked_Purchase', 'Retail');
    trigger_stripe_payment_request();
}
function on_click_collector_year_button(e) {
    console.log("DEBUG on_click_collector_year_button v2");
    e.preventDefault();
    var form = $('.js-stripe-payment-button-retail').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-retail-year').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button').closest("form");
    form.attr("id", "");
    var form = $('.js-stripe-payment-button-year').closest("form");
    form.attr("id", "js-submitted");
    analytics_track_event('PricechartingPro', 'Clicked_Purchase', 'Pro Year');
    trigger_stripe_payment_request();
}
function on_click_legendary_year_button(e) {
    console.log("DEBUG on_click_legendary_year_button");
    e.preventDefault();
    var form = $('.js-stripe-payment-button').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-year').closest("form");
    form.attr("id", "");
    form = $('.js-stripe-payment-button-retail').closest("form");
    form.attr("id", "");
    var form = $('.js-stripe-payment-button-retail-year').closest("form");
    form.attr("id", "js-submitted");
    analytics_track_event('PricechartingPro', 'Clicked_Purchase', 'Retail Year');
    trigger_stripe_payment_request();
}
function show_feature_descriptions() {
    $('.js-show-description').hover(function () {
        var desc = $(this).text();
        analytics_track_event('PricechartingPro', 'Show_Description', desc);
        $(this).parent().find("div.tour").toggle();
    }, function () {
        $(this).parent().find("div.tour").toggle();
    });
}
function is_upgrading() {
    var token = $('.js-upgrade-token').val();
    return !!token;
}
function ask_user_for_purchase_duration(name) {
    console.log("DEBUG ask_user_for_purchase_duration: " + name);
    if (is_upgrading()) {
        console.log("DEBUG is_upgrading");
        $('.js-30-days-button').click();
        return;
    }
    var modalName = 'js-duration-choice-dialog-' + name;
    var modal = $('#' + modalName);
    modal.dialog({
        'modal': true,
        'draggable': false,
        'resizable': false,
        'position': {
            my: "top",
            at: "top",
            of: $('#custom-price-guide-page')
        },
        'width': 450
    });
    $(".ui-dialog-titlebar").css({ "display": "none" });
}
function show_more_features() {
    $('.js-show-more').click(function (e) {
        analytics_track_event('PricechartingPro', 'Show_More', 'Clicked');
        $(this).closest("div").find("li.hidden-li").toggle();
    });
}
function implement_download_price_guide() {
    $('.js-download-button').click(function (e) {
        var url = $('.js-download-link').attr('href');
        window.location.href = url;
    });
}
function trigger_stripe_payment_request() {
    console.log("DEBUG trigger_stripe_payment_request");
    if (is_upgrading()) {
        on_stripe_token_available({ id: 'upgrade-token' });
        return;
    }
    var siteName = "PriceCharting";
    var desc = "Subscription";
    if (window.location.hostname.indexOf("sportscardspro") !== -1) {
        siteName = "SportsCardsPro";
        desc = "Subscription";
    }
    var amount = $('.js-grand-total-pennies').val();
    if ($('#js-submitted').length != 0) {
        amount = $('#js-submitted').find('.js-grand-total-pennies').val();
    }
    if (amount == 44900 || amount == 5900) {
        if (siteName == "SportsCardsPro") {
            desc = "SportsCardsPro 1 Year";
        }
        else {
            desc = "PriceCharting 1 Year";
        }
    }
    StripeCheckout.configure({
        'key': StripePublicKey
    }).open({
        'billingAddress': false,
        'amount': Number(amount),
        'currency': 'usd',
        'name': siteName,
        'description': desc,
        'panelLabel': 'Pay',
        'token': on_stripe_token_available
    });
    return false;
}
function show_error_upgrade_browser() {
    $('.js-error-upgrade-browser').dialog({});
}
window['show_error_upgrade_browser'] = show_error_upgrade_browser;
function on_stripe_token_available(res) {
    var form = $('.js-custom-guide-form');
    form.find('input[name=stripe-token]').val(res.id);
    if ($('#js-submitted').length != 0) {
        form = $('#js-submitted');
    }
    var timer = setTimeout(function () {
        analytics_track_event('Error', 'Processing payment', 'create-custom too slow');
        console.log("err: create-custom too slow");
        close_timed_dialog();
        show_error_upgrade_browser();
    }, 15000);
    var msg = 'Processing payment';
    if (is_upgrading()) {
        msg = 'Changing your guide';
    }
    show_timed_dialog(10000, msg);
    var query = form.serialize();
    var url = '/price-guide/create-custom?' + query;
    $.ajax({
        "type": "GET",
        "url": url,
        "xhrFields": {
            "withCredentials": true,
        },
        "error": function (req, status, error) {
            analytics_track_event('Error', 'Processing payment', 'AJAX fail');
            console.log("url: " + url);
            console.log("err: create-custom AJAX fail: " + status + " | " + error);
            clearTimeout(timer);
            close_timed_dialog();
            show_error_upgrade_browser();
        },
        "success": function (data) {
            clearTimeout(timer);
            close_timed_dialog();
            if (data["access_token"]) {
                var token = data["access_token"];
                if (is_pricecharting_pro_page()) {
                    if (window.location.hostname == "www.sportscardspro.com") {
                        window.location.href = VGPC.www_url + '/sportscardspro-premium?token=' + token;
                    }
                    else {
                        window.location.href = VGPC.www_url + '/pricecharting-pro?token=' + token;
                    }
                }
                else {
                    window.location.href = VGPC.www_url + '/download-price-guide/' + token;
                }
            }
            else {
                var options = {
                    'buttons': {
                        'Try again': function () {
                            close_error_dialog();
                            trigger_stripe_payment_request();
                        }
                    }
                };
                show_error_dialog('Processing payment', data["error"], options);
            }
        }
    });
}
var timed_dialog_interval;
function show_timed_dialog(duration, message) {
    var dialog = $('.js-timed-dialog');
    dialog.find('.message').text(message);
    var value = 1;
    var max = duration / 100;
    $('.js-timed-progress-bar').progressbar({
        'max': max,
        'value': value
    });
    dialog.dialog({
        'draggable': false,
        'resizable': false,
        'modal': true
    });
    timed_dialog_interval = window.setInterval(function () {
        value++;
        if (value > max) {
            window.clearInterval(timed_dialog_interval);
            value = false;
            analytics_track_event('Error', message, 'Progress expired');
        }
        $('.js-timed-progress-bar').progressbar("option", "value", value);
    }, 100);
}
function close_timed_dialog() {
    window.clearInterval(timed_dialog_interval);
    $('.js-timed-dialog').dialog('close');
}
function show_error_dialog(context, error, options) {
    if (!options)
        options = {};
    var div = $('.js-error-dialog');
    analytics_track_event('Error', context, error);
    div.find('.context').text(context);
    div.find('.error').text(error);
    options['modal'] = true;
    div.dialog(options);
}
function close_error_dialog() {
    $('.js-error-dialog').dialog('close');
}
var highstock_chart;
var pop_chart;
function convert_game_price_chart_data() {
    if (!VGPC || !VGPC.chart_data)
        return;
    ['used', 'cib', 'new', 'graded', 'boxonly', 'manualonly'].forEach(function (c) {
        if (!VGPC.chart_data[c])
            return;
        for (var _i = 0, _a = VGPC.chart_data[c]; _i < _a.length; _i++) {
            var p = _a[_i];
            p[1] = p[1] / 100;
        }
    });
    render_game_price_chart();
}
function render_game_price_chart() {
    var options = {
        chart: {
            renderTo: 'chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        colors: ['#0176d5', '#d5b901', '#d5013d', '#333333', '#9901d5', '#d54f01', '#cccccc'],
        tooltip: {
            backgroundColor: '#8e8e8e',
            borderColor: '#696969',
            shared: true,
            valueDecimals: 2,
            xDateFormat: '%B %Y',
        },
        plotOptions: {
            series: {
                animation: false,
                events: {
                    legendItemClick: function (e) {
                        var series = this;
                        var action = series['visible'] ? 'Hide' : 'Show';
                    }
                }
            },
            line: {
                events: {
                    mouseOver: function (e) {
                    }
                }
            }
        },
        rangeSelector: {
            inputEnabled: false,
            selected: 4,
            buttons: [
                {
                    type: 'month',
                    count: 6,
                    text: '6m'
                },
                {
                    type: 'year',
                    count: 1,
                    text: '1y'
                },
                {
                    type: 'year',
                    count: 5,
                    text: '5y'
                },
                {
                    type: 'all',
                    text: 'All'
                }
            ]
        },
        navigator: {
            enabled: false
        },
        scrollbar: {
            enabled: false
        },
        legend: {
            align: 'right',
            verticalAlign: 'top',
            floating: true,
            enabled: true
        },
        yAxis: [{
                min: 0,
                labels: {
                    format: '${value}',
                },
                opposite: true,
            }],
        series: []
    };
    var usedVisibility = true;
    var cibVisibility = false;
    if (VGPC.product.is_disc) {
        usedVisibility = false;
        cibVisibility = true;
    }
    if (VGPC.product.is_old) {
        usedVisibility = false;
        cibVisibility = true;
    }
    if (VGPC.product.is_card) {
        options.series.push({
            name: 'Ungraded',
            data: VGPC.chart_data.used,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '7',
            data: VGPC.chart_data.cib,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '8',
            data: VGPC.chart_data.new,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '9',
            data: VGPC.chart_data.graded,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'BGS 9.5',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PSA 10',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else if (VGPC.product.is_comic) {
        options.series.push({
            name: 'Raw',
            data: VGPC.chart_data.used,
            visible: usedVisibility,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '4.0',
            data: VGPC.chart_data.cib,
            visible: cibVisibility,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '6.0',
            data: VGPC.chart_data.new,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '8.0',
            data: VGPC.chart_data.graded,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '9.2',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: '9.8',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else if (VGPC.product.is_proof_coin) {
        options.series.push({
            name: 'Ungraded',
            data: VGPC.chart_data.used,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PR62',
            data: VGPC.chart_data.cib,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PR64',
            data: VGPC.chart_data.new,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PR66',
            data: VGPC.chart_data.graded,
            visible: true,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PR68',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'PR70',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else if (VGPC.product.is_coin) {
        options.series.push({
            name: 'Ungraded',
            data: VGPC.chart_data.used,
            visible: true,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'VF',
            data: VGPC.chart_data.cib,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'AU',
            data: VGPC.chart_data.new,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'MS62',
            data: VGPC.chart_data.graded,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'MS64',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'MS66',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else if (VGPC.product.is_lego_set) {
        options.series.push({
            name: 'Pieces',
            data: VGPC.chart_data.used,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'CIB',
            data: VGPC.chart_data.cib,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'New',
            data: VGPC.chart_data.new,
            visible: true,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'Box',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'Manual',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else if (VGPC.product.is_funko_pop) {
        options.series.push({
            name: 'Loose',
            data: VGPC.chart_data.used,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'In Box',
            data: VGPC.chart_data.cib,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'New',
            data: VGPC.chart_data.new,
            visible: true,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    else {
        options.series.push({
            name: 'Loose',
            data: VGPC.chart_data.used,
            visible: usedVisibility,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'CIB',
            data: VGPC.chart_data.cib,
            visible: cibVisibility,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'New',
            data: VGPC.chart_data.new,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'Graded',
            data: VGPC.chart_data.graded,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'Box',
            data: VGPC.chart_data.boxonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
        options.series.push({
            name: 'Manual',
            data: VGPC.chart_data.manualonly,
            visible: false,
            type: 'spline',
            tooltip: {
                valuePrefix: "$",
            },
        });
    }
    if (VGPC.volume_data) {
        options.series.push({
            name: 'Volume',
            data: VGPC.volume_data.volume,
            visible: true,
            type: 'column',
            yAxis: 1,
            maxPointWidth: 20,
            zIndex: -1,
            tooltip: {
                valuePrefix: "",
                valueSuffix: " (total volume)",
            },
        });
        options.yAxis.push({
            min: 0,
            labels: {
                format: '{value}',
            },
            opposite: false,
        });
    }
    highstock_chart = new Highcharts.StockChart(options);
    return;
}
function render_collection_price_chart() {
    if (!VGPC || !VGPC.chart_data)
        return;
    ['value', 'count', 'profit', 'cost'].forEach(function (c) {
        for (var _i = 0, _a = VGPC.chart_data[c]; _i < _a.length; _i++) {
            var p = _a[_i];
            p[1] = p[1] / 100;
        }
    });
    highstock_chart = new Highcharts.StockChart({
        chart: {
            renderTo: 'chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        colors: ['#0176d5', '#d5b901', '#d5013d', '#333333', '#9901d5', '#d54f01'],
        tooltip: {
            backgroundColor: '#8e8e8e',
            borderColor: '#696969',
            xDateFormat: '%b %e, %Y',
            valueDecimals: 2,
        },
        plotOptions: {
            series: {
                animation: false,
                events: {
                    legendItemClick: function (e) {
                        var series = this;
                        var action = series['visible'] ? 'Hide' : 'Show';
                    }
                }
            },
        },
        rangeSelector: {
            inputEnabled: false,
            selected: 4,
            buttons: [
                {
                    type: 'month',
                    count: 6,
                    text: '6m'
                },
                {
                    type: 'year',
                    count: 1,
                    text: '1y'
                },
                {
                    type: 'year',
                    count: 5,
                    text: '5y'
                },
                {
                    type: 'all',
                    text: 'All'
                }
            ]
        },
        navigator: {
            enabled: false
        },
        scrollbar: {
            enabled: false
        },
        legend: {
            align: 'right',
            verticalAlign: 'top',
            floating: true,
            enabled: true
        },
        xAxis: {
            labels: {
                formatter: function () {
                    return Highcharts.dateFormat('%b %e, %Y', this.value);
                }
            }
        },
        yAxis: {
            labels: {
                format: '${value}',
            },
        },
        series: [
            {
                name: 'Value',
                data: VGPC.chart_data.value,
                type: 'spline',
            },
            {
                name: 'Count',
                data: VGPC.chart_data.count,
                type: 'spline',
                visible: false,
            },
            {
                name: 'Cost',
                data: VGPC.chart_data.cost,
                type: 'spline',
                visible: false,
            },
            {
                name: 'Profit',
                data: VGPC.chart_data.profit,
                type: 'spline',
                visible: false,
            }
        ]
    });
    return;
}
function render_console_price_chart() {
    if (!VGPC || !VGPC.chart_data)
        return;
    ['value', 'median'].forEach(function (c) {
        for (var _i = 0, _a = VGPC.chart_data[c]; _i < _a.length; _i++) {
            var p = _a[_i];
            p[1] = p[1] / 100;
        }
    });
    highstock_chart = new Highcharts.StockChart({
        chart: {
            renderTo: 'chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        colors: ['#0176d5', '#d5b901', '#d5013d', '#333333', '#9901d5', '#d54f01'],
        tooltip: {
            backgroundColor: '#8e8e8e',
            borderColor: '#696969',
            xDateFormat: '%b %Y',
            valueDecimals: 2,
        },
        plotOptions: {
            series: {
                animation: false,
                events: {
                    legendItemClick: function (e) {
                        var series = this;
                        var action = series['visible'] ? 'Hide' : 'Show';
                    }
                }
            },
        },
        rangeSelector: {
            enabled: false
        },
        navigator: {
            enabled: false
        },
        scrollbar: {
            enabled: false
        },
        legend: {
            align: 'right',
            verticalAlign: 'top',
            floating: true,
            enabled: true
        },
        xAxis: {
            labels: {
                formatter: function () {
                    return Highcharts.dateFormat('%b %Y', this.value);
                }
            }
        },
        yAxis: {
            labels: {
                format: '${value}',
            },
        },
        series: [
            {
                name: 'Average',
                data: VGPC.chart_data.value,
                type: 'spline',
            },
            {
                name: 'Median',
                data: VGPC.chart_data.median,
                type: 'spline',
            },
        ]
    });
    return;
}
function render_pop_chart() {
    if (!VGPC || !VGPC.pop_data)
        return;
    var options = {
        chart: {
            type: 'area',
            renderTo: 'pop-chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        title: {
            text: ''
        },
        colors: ['#0176d5'],
        legend: {
            enabled: false
        },
        xAxis: {
            categories: ['1', '2', '3', '4', '5', '6', '7', '8', '9.0', '9.2', '9.4', '9.6', '9.8', '10']
        },
        yAxis: {
            title: {
                text: 'Population'
            },
        },
        series: [
            {
                name: 'Population',
                data: VGPC.pop_data.pop,
            },
        ]
    };
    pop_chart = new Highcharts.Chart(options);
    if (VGPC.product.is_card) {
        pop_chart.xAxis[0].update({
            categories: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
        });
    }
    return;
}
function render_compare_price_chart() {
    if (!VGPC || !VGPC.compare_data)
        return;
    ['zero', 'one', 'two'].forEach(function (c) {
        if (!VGPC.compare_data[c]) {
        }
        else {
            for (var _i = 0, _a = VGPC.compare_data[c]; _i < _a.length; _i++) {
                var p = _a[_i];
                p[1] = p[1] / 100;
            }
        }
    });
    highstock_chart = new Highcharts.StockChart({
        chart: {
            renderTo: 'chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        colors: ['#0176d5', '#d5b901', '#d5013d'],
        tooltip: {
            backgroundColor: '#8e8e8e',
            borderColor: '#696969',
            xDateFormat: '%b %Y',
            valueDecimals: 2,
        },
        plotOptions: {
            series: {
                animation: false,
                events: {
                    legendItemClick: function (e) {
                        var series = this;
                        var action = series['visible'] ? 'Hide' : 'Show';
                    }
                }
            },
        },
        navigator: {
            enabled: false
        },
        scrollbar: {
            enabled: false
        },
        legend: {
            align: 'right',
            verticalAlign: 'top',
            floating: true,
            enabled: true
        },
        xAxis: {
            labels: {
                formatter: function () {
                    return Highcharts.dateFormat('%b %Y', this.value);
                }
            }
        },
        yAxis: {
            labels: {
                format: '${value}',
            },
        },
    });
    if (VGPC.compare_data.zero) {
        highstock_chart.addSeries({
            name: VGPC.label_data.zero,
            data: VGPC.compare_data.zero,
            type: 'spline',
        }, true);
    }
    if (VGPC.compare_data.one) {
        highstock_chart.addSeries({
            name: VGPC.label_data.one,
            data: VGPC.compare_data.one,
            type: 'spline',
        }, true);
    }
    if (VGPC.compare_data.two) {
        highstock_chart.addSeries({
            name: VGPC.label_data.two,
            data: VGPC.compare_data.two,
            type: 'spline',
        }, true);
    }
    return;
}
function render_card_centering_debug_chart() {
    if (!VGPC || !VGPC.chart_data)
        return;
    highstock_chart = new Highcharts.StockChart({
        chart: {
            renderTo: 'chart',
            borderWidth: 1,
            borderRadius: 0,
            borderColor: '#ffffff',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Arial, Verdana, Geneva, Helvetica, sans-serif'
            }
        },
        rangeSelector: {
            enabled: false
        },
        plotOptions: {
            series: {
                animation: false,
                events: {
                    legendItemClick: function (e) {
                        var series = this;
                        var action = series['visible'] ? 'Hide' : 'Show';
                    }
                }
            }
        },
        navigator: {
            enabled: false
        },
        scrollbar: {
            enabled: false
        },
        legend: {
            align: 'right',
            verticalAlign: 'top',
            floating: true,
            enabled: true
        },
        xAxis: {
            labels: {
                format: '{value}',
            },
        },
        yAxis: {
            labels: {
                enabled: false
            },
        },
        series: [
            {
                name: 'X Colors',
                data: VGPC.chart_data.xcolor,
                type: 'scatter',
                visible: false,
            },
            {
                name: 'X Slopes',
                data: VGPC.chart_data.xslope,
                type: 'scatter',
                visible: false,
            },
            {
                name: 'X Sobel',
                data: VGPC.chart_data.xavg,
                type: 'line',
                tooltip: {
                    pointFormat: 'x: {point.x} y: {point.y}',
                },
            },
            {
                name: 'Y Colors',
                data: VGPC.chart_data.ycolor,
                type: 'scatter',
                visible: false,
            },
            {
                name: 'Y Slopes',
                data: VGPC.chart_data.yslope,
                type: 'scatter',
                visible: false,
            },
            {
                name: 'X Sobel',
                data: VGPC.chart_data.yavg,
                type: 'line',
                tooltip: {
                    pointFormat: 'x: {point.x} y: {point.y}',
                },
                visible: false,
            }
        ]
    });
    return;
}
function implement_show_chart_on_mobile() {
    $('#chart_link > a').click(function (e) {
        e.preventDefault();
        var chart = $('#chart');
        var chartContainer = $('#chart-container');
        if (chart.is(':visible')) {
            chart.css('display', "");
            chartContainer.hide();
        }
        else {
            chart.show();
            chartContainer.show();
            render_game_price_chart();
        }
        analytics_track_event("Chart", "Visible_on_Mobile");
    });
}
function implement_price_guides_page() {
    $('.js-cancel-subscription-link').click(function (e) {
        e.preventDefault();
        var target = $(e.target);
        var token = target.data('access-token');
        $('.js-access-token').val(token);
    });
}
function implement_priceit_game() {
    implement_start_game();
    handle_price_click();
    show_high_scores();
    share_this_clicked();
}
var row_list = VGPC.row_list;
var placements = ["low", "mid", "high"];
var game_duration = 60;
var score = 0;
var correct = 0;
var guesses = 0;
var key = VGPC.category + "-high-scores";
function implement_start_game() {
    $(".start").click(function (e) {
        analytics_track_event('Tools', 'PriceIt', 'Start');
        e.preventDefault();
        score = 0;
        correct = 0;
        guesses = 0;
        $("#score span.value").text(score);
        $("#timer").removeClass("done");
        $("#timer span.value").text(game_duration);
        $("#answers table tr.answer").remove();
        $("#historic table tr.historic").remove();
        set_random_item();
        $("#rules").hide();
        $("#game_item").show();
        $("#final_score").hide();
        $("#answers").hide();
        $("#historic").hide();
        $("#play_again").hide();
        start_timer();
    });
}
function start_timer() {
    $("#timer_and_score").show();
    var seconds_left = game_duration;
    var x = setInterval(function () {
        if (seconds_left <= 0) {
            clearInterval(x);
            $("#timer").addClass("done");
            game_is_done();
        }
        else {
            seconds_left -= 1;
            $("#timer span.value").text(seconds_left);
        }
    }, 1000);
}
function set_random_item() {
    var list_size = Object.keys(row_list).length;
    var rand = Math.floor(Math.random() * list_size);
    var item = row_list[rand];
    $("#game_item h2.name").data('position', rand);
    rand = Math.floor(Math.random() * placements.length);
    var placement = placements[rand];
    var correct_price = Math.round(item.prices.price_1);
    $("#choices #" + placement + " span").text("$" + correct_price);
    var percent = (Math.floor(Math.random() * 20) + 40) / 100;
    var dollars = 5;
    var low_price = 0;
    var mid_price = 0;
    var high_price = 0;
    if (placement === "low") {
        low_price = correct_price;
        mid_price = Math.ceil(correct_price * (1 + percent) + dollars);
        $("#choices #mid span").text("$" + mid_price);
        high_price = Math.ceil(mid_price * (1 + percent) + dollars);
        $("#choices #high span").text("$" + high_price);
    }
    if (placement === "mid") {
        mid_price = correct_price;
        low_price = Math.ceil(correct_price * (1 - percent));
        $("#choices #low span").text("$" + low_price);
        high_price = Math.ceil(correct_price * (1 + percent) + dollars);
        $("#choices #high span").text("$" + high_price);
    }
    if (placement === "high") {
        high_price = correct_price;
        mid_price = Math.ceil(correct_price * (1 - percent));
        $("#choices #mid span").text("$" + mid_price);
        low_price = Math.ceil(mid_price * (1 - percent));
        $("#choices #low span").text("$" + low_price);
    }
    $("#game_item h2.name").text(item.label);
    $("#game_item h3.console span").text(item.console);
    $("#game_item #image img").attr("src", item.blob);
    $("#answers table tr:last").after("<tr class='answer'><td><a href='/game/" + item.id + "'>" + item.label + "</a></td><td class='low'><span>$" + low_price + "</span></td><td class='mid'><span>$" + mid_price + "</span></td><td class='high'><span>$" + high_price + "</span></td></tr>");
}
function handle_price_click() {
    $(".choice").click(function (e) {
        e.preventDefault();
        guesses += 1;
        var placement = $(this).prop('id');
        var chosen_price = $(e.target).closest('span').text();
        var position = $("#game_item h2.name").data('position');
        var item = row_list[position];
        var correct_price = Math.round(item.prices.price_1);
        var correct_price_str = "$" + correct_price;
        if (correct_price_str === chosen_price) {
            score += 100;
            correct += 1;
            $("#score").animate({
                "background-color": "#9fdf9f",
            }, 150);
            $("#score").animate({
                "background-color": "#ddd",
            }, 150);
            $("#answers table tr:last td." + placement).addClass("right");
        }
        else {
            score -= 100;
            $("#score").animate({
                "background-color": "#DF9F9F",
            }, 150);
            $("#score").animate({
                "background-color": "#ddd",
            }, 150);
            $("#answers table tr:last td." + placement).addClass("wrong");
            $("#answers table tr:last td").each(function () {
                var value = $(this).find("span").text();
                if (value === correct_price_str) {
                    $(this).addClass("right");
                }
            });
        }
        $("#score span.value").text(score);
        set_random_item();
    });
}
function game_is_done() {
    analytics_track_event('Tools', 'PriceIt', 'Finished');
    var accuracy = 0;
    if (guesses > 0) {
        accuracy = Math.round((correct / guesses) * 100);
    }
    $("#the_score").text(score);
    $("#correct").text(correct);
    $("#accuracy").text(accuracy + "%");
    var game_name = $("h1#head").text();
    var share_content = "My " + game_name + " Score = " + score + ".  " + correct + " correct and " + accuracy + "% accuracy.  Try it: " + window.location.origin + "/price-it/" + VGPC.category;
    $("#share_this_content").text(share_content);
    $("#final_score").show();
    $("#game_item").hide();
    $("#answers").show();
    $("#historic").show();
    $("#play_again").show();
    $("#timer_and_score").hide();
    maybe_add_to_high_score();
    show_high_scores();
    $("#game_container").css("height", "auto");
}
function maybe_add_to_high_score() {
    var array_max = 10;
    var scores = [];
    var stored_scores = localStorage[key];
    if (stored_scores === undefined) {
    }
    else if (stored_scores != "[null]") {
        scores = JSON.parse(stored_scores);
    }
    var new_score = score;
    var added_new_entry = false;
    var array_length = scores.length;
    for (var i = 0; i < array_length; i++) {
        var s = scores[i];
        if (new_score >= s) {
            scores.splice(i, 0, new_score);
            added_new_entry = true;
            break;
        }
    }
    if (scores.length < array_max && added_new_entry === false) {
        scores.splice(scores.length, 0, new_score);
    }
    if (scores.length > array_max) {
        scores.splice(array_max, 1);
    }
    var value = JSON.stringify(scores);
    localStorage[key] = value;
}
function show_high_scores() {
    var stored_scores = localStorage[key];
    var scores = [];
    if (stored_scores === undefined) {
        return;
    }
    else if (stored_scores != "[null]") {
        scores = JSON.parse(stored_scores);
    }
    else {
        return;
    }
    var new_score = $("#the_score").text();
    var marked_new_score = false;
    var array_length = scores.length;
    for (var i = 0; i < array_length; i++) {
        var scr = scores[i];
        var str = "" + scr + "";
        if (!marked_new_score && new_score == scr) {
            str = "<span class='new_score'>" + scr + "</span>";
            marked_new_score = true;
        }
        var rank = i + 1;
        $("#historic table tr:last").after("<tr class='historic'><td class='rank'>" + rank + "</td><td>" + str + "</td></tr>");
    }
    $("#historic").show();
}
function share_this_clicked() {
    $("#share").click(function (e) {
        analytics_track_event('Tools', 'PriceIt', 'Share');
        e.preventDefault();
        var temp = $("<input>");
        $("body").append(temp);
        var txt = $("#share_this_content").text();
        temp.val(txt).select();
        document.execCommand("copy");
        temp.remove();
        $("#copied").text("Copied to Clipboard");
        $("#copied").show().delay(1000).fadeOut();
    });
}
function implement_photo_inputs() {
    var uploaders = $('.upload_image');
    uploaders.find('input').change(function (e) {
        var input = e.target;
        if (input.files.length > 0) {
            show_image_rotate_overlay(input.files[0], function (rotatedImage) {
                resize_image_blob(rotatedImage, function (image) {
                    show_image_thumbnail(input, image, 0.2);
                    upload_image(input, image);
                });
                show_next_image_input(input);
            });
        }
    });
    uploaders.first().find('input').show();
    uploaders.first().find('span').show();
}
function show_image_rotate_overlay(rawImage, onDoneCallback) {
    var angles = [0 * Math.PI, 0.5 * Math.PI, Math.PI, 1.5 * Math.PI];
    var index = 0;
    var imageModalOverlay = $('#image-rotate-modal-overlay');
    var imageModal = imageModalOverlay.find('.image-rotate-modal');
    var leftRotateButton = imageModalOverlay.find('.rotate-left');
    var rightRotateButton = imageModalOverlay.find('.rotate-right');
    var confirmButton = imageModalOverlay.find('.rotate-confirm');
    var canvas = imageModalOverlay.find('.image-rotate-canvas')[0];
    var ctx = canvas.getContext('2d');
    var image = new Image();
    var fr = new FileReader();
    imageModalOverlay.show();
    resize_image_blob(rawImage, function (image) {
        fr.onload = prepare_image;
        fr.readAsDataURL(image);
    });
    function prepare_image() {
        image.onload = function () {
            insert_image_into_rotate_canvas(image);
        };
        image.src = this.result;
        leftRotateButton.click(rotateCCW);
        rightRotateButton.click(rotateCW);
        confirmButton.click(function () {
            confirmRotation();
            cleanup();
        });
    }
    function insert_image_into_rotate_canvas(image) {
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);
    }
    function rotateCCW() {
        index--;
        if (index < 0)
            index = angles.length - 1;
        renderImage();
    }
    function rotateCW() {
        index++;
        if (index >= angles.length)
            index = 0;
        renderImage();
    }
    function renderImage() {
        switch (index) {
            case 0:
            case 2:
                canvas.width = image.width;
                canvas.height = image.height;
                break;
            case 1:
            case 3:
                canvas.width = image.height;
                canvas.height = image.width;
                break;
        }
        var angle = angles[index], cw = canvas.width * 0.5, ch = canvas.height * 0.5;
        ctx.translate(cw, ch);
        ctx.rotate(angle);
        ctx.translate(-image.width * 0.5, -image.height * 0.5);
        ctx.drawImage(image, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    function confirmRotation() {
        canvas_to_blob(canvas, onDoneCallback);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        imageModalOverlay.hide();
    }
    function cleanup() {
        [leftRotateButton, rightRotateButton, confirmButton].forEach(function (button) { return button.unbind('click'); });
        imageModalOverlay = null;
        imageModal = null;
        leftRotateButton = null;
        rightRotateButton = null;
        confirmButton = null;
        canvas = null;
        ctx = null;
        image = null;
        fr = null;
    }
}
function show_image_thumbnail(input, blob, opacity) {
    var url = URL.createObjectURL(blob);
    var thumbnail = $(input).closest('.upload_image').find('.thumbnail');
    thumbnail.find('img').attr('src', url);
    thumbnail.css('display', 'table-cell');
    thumbnail.css('opacity', opacity);
}
function show_next_image_input(input) {
    input.disabled = true;
    var uploader = $(input).closest('.upload_image');
    uploader.next('.upload_image').find('input').show();
    uploader.next('.upload_image').find('span').show();
}
function upload_image(input, image) {
    var uploader = $(input).closest('.upload_image');
    var thumbnail = uploader.find('.thumbnail');
    var fd = new FormData();
    fd.append("img", image);
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload-img");
    xhr.onload = function () {
        var response = JSON.parse(xhr.response);
        var blob_id = response.blob_id;
        uploader.find('.js-blob-id').val(blob_id);
        uploader.find('.js-caption').prop('required', true);
        thumbnail.css('opacity', '1');
    };
    xhr.send(fd);
}
function mark_image_for_deletion() {
    $('.js-delete-image').click(function (e) {
        e.preventDefault();
        var blobKey = $(this).data("blob-key");
        var div = $(this).closest('div.extra-image');
        var form = $(this).closest('form');
        div.css('opacity', '0.2');
        $('<input>').attr({
            type: 'hidden',
            id: blobKey,
            name: blobKey,
            value: 'delete'
        }).appendTo(form);
        var input = div.children('input')[0];
        input.remove();
    });
}
function resize_image_blob(large, f, maxWidth, maxHeight) {
    var MAX_WIDTH = maxWidth ? maxWidth : 1600;
    var MAX_HEIGHT = maxHeight ? maxHeight : 1600;
    var img = document.createElement('img');
    img.src = URL.createObjectURL(large);
    img.onload = function (e) {
        var width = img.width;
        var height = img.height;
        if (width <= MAX_WIDTH && height <= MAX_HEIGHT) {
            f(large);
            return;
        }
        if (width > height) {
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
        }
        else {
            if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
            }
        }
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas_to_blob(canvas, f);
    };
}
function canvas_to_blob(canvas, f) {
    var type = "image/jpeg";
    var quality = 1.0;
    if (HTMLCanvasElement.prototype.toBlob) {
        canvas.toBlob(f, type, quality);
        return;
    }
    var binStr = atob(canvas.toDataURL(type, quality).split(',')[1]), len = binStr.length, arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        arr[i] = binStr.charCodeAt(i);
    }
    var blob = new Blob([arr], { type: type });
    f(blob);
}
function implement_listing_validation() {
    var blemishes = ['writing', 'stickers', 'tear', 'scratch', 'broken'];
    $('[name=pristine]').change(function (e) {
        if ($(this).prop('checked')) {
            blemishes.forEach(function (id) {
                $('[name=' + id + ']').prop('checked', false);
            });
        }
    });
    blemishes.forEach(function (id) {
        $('[name=' + id + ']').change(function () {
            if ($(this).prop('checked')) {
                $('[name=pristine]').prop('checked', false);
            }
        });
    });
    $('#price input[type=number]').keydown(function (e) {
        if (e.shiftKey) {
            e.preventDefault();
        }
        else if (e.ctrlKey || e.metaKey) {
        }
        else if (e.which == 190 || e.which == 110) {
        }
        else if (e.which <= 57) {
        }
        else if (e.which >= 96 && e.which <= 105) {
        }
        else {
            e.preventDefault();
        }
    });
    $('#make_listing form').submit(function (e) {
        $('p.js-error').hide();
        var first_error;
        var oops = function (error_element) {
            e.preventDefault();
            if (!first_error)
                first_error = error_element.get(0);
        };
        $('#price input[type=number]').each(function () {
            if (this.checkValidity())
                return;
            var error = $('#price p.js-error');
            error.text("Please enter valid numbers for price");
            error.show();
            oops(error);
        });
        if (first_error) {
            first_error.scrollIntoView();
            return;
        }
        var ignore = $('#js-dialog-publish-suggestions').data('ignore');
        if (ignore) {
        }
        else {
            var price = $('input[name=max-price]').val();
            price = Currency.fromString(price);
            var rec_price = $('.js-recommended-price').text();
            rec_price = Currency.fromString(rec_price);
            if (price.pennies > rec_price.pennies && rec_price.pennies > 0) {
                var suggestionType = "Price-Too-High";
                var title = "Your price is high";
                var body = "Lower your price to " + rec_price + " and it's 2x more likely to sell.";
                change_dialog_details(title, body, suggestionType);
                e.preventDefault();
                return;
            }
            var photo_count = $('.upload_image input.js-blob-id[value]').length;
            if (photo_count == 0) {
                var suggestionType = "Include-Photo";
                var title = "No photos added";
                var body = "Buyers love photos!  Listings with good price & a photo sell 85% of the time";
                change_dialog_details(title, body, suggestionType);
                e.preventDefault();
                return;
            }
        }
        $('input[type="file"]').remove();
        $(e.target).find('input[type=submit]').prop('disabled', true);
    });
}
function implement_fee_calculation() {
    var stripeFeeVariable = 0.0349;
    var stripeFeeFixed = 0.49;
    $('input[name=max-price]').change(function () {
        var price = $(this).val();
        var payFee = (price * stripeFeeVariable) + stripeFeeFixed;
        $('#js-payfee').text(payFee.toFixed(2));
    });
}
function change_dialog_details(title, body, suggestionType) {
    var name = "publish-suggestions";
    var dialog = "#js-dialog-publish-suggestions";
    $(dialog + " p").text(body);
    $(dialog).data("suggestion-type", suggestionType);
    show_dialog_with_title(name, title);
}
function implement_publish_offer_suggestions() {
    var dialog = "#js-dialog-publish-suggestions";
    var suggestionType = "";
    $('#js-edit-listing').click(function (e) {
        suggestionType = $(dialog).data('suggestion-type');
        $(dialog).dialog('close');
        e.preventDefault();
    });
    $('#js-continue-as-is').click(function (e) {
        suggestionType = $(dialog).data('suggestion-type');
        $(dialog).dialog('close');
        $(dialog).data('ignore', true);
        $('#make_listing form').submit();
        e.preventDefault();
    });
}
var SearchByPhoto;
(function (SearchByPhoto) {
    var maxWidth = 768;
    var maxHeight = 768;
    function init() {
        implement_upload_photo();
        implement_dialogs();
        implement_photo_item_click();
    }
    SearchByPhoto.init = init;
    function implement_upload_photo() {
        var uploaders = $("#search-by-photo");
        uploaders.find("input").change(function (e) {
            var category = $("#js-photo-category").val();
            if (category === "") {
                alert("Please select a category for photo search");
                return;
            }
            var input = e.target;
            if (input.files.length > 0) {
                resize_image_blob(input.files[0], function (image) {
                    show_image_thumbnail(input, image, 0.2);
                    clearResults();
                    search_by_photo(input, image);
                }, maxWidth, maxHeight);
            }
        });
        uploaders.first().find("input").show();
        uploaders.first().find("span").show();
    }
    function show_image_thumbnail(input, blob, opacity) {
        var url = URL.createObjectURL(blob);
        var thumbnail = $(input).closest(".upload_image").find(".thumbnail");
        thumbnail.find("img").attr("src", url);
        thumbnail.css("display", "inline-block");
        thumbnail.css("opacity", opacity);
    }
    function search_by_photo(input, image) {
        var uploader = $(input).closest(".upload_image");
        var thumbnail = uploader.find(".thumbnail");
        $('#poor-results').hide();
        var category = $("#js-photo-category").val();
        var label = category + "_Submitted_Photo";
        analytics_track_event('Tools', 'SearchByPhoto', label);
        var language = $("#js-photo-language").val();
        if (language !== "" && language !== 'undefined') {
            createCookie("photo_language", language, 5000);
        }
        $("#js-processing").show();
        $(".search-by-photo-results p.header").hide();
        var fd = new FormData();
        fd.append("img", image);
        fd.append("category", category);
        fd.append("language", language);
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/search-by-photo");
        xhr.onload = function () {
            var srcImgID = xhr.getResponseHeader("x-src-image-id");
            var response = JSON.parse(xhr.response);
            thumbnail.css("opacity", "1");
            fill_results(response, srcImgID);
        };
        xhr.send(fd);
    }
    function fill_results(response, srcImgID) {
        var category = $("#js-photo-category").val();
        var results = $("div.result");
        if (category === "yugioh-cards") {
            $("#js-processing").hide();
            $(".search-by-photo-results p.header").show();
            if (response.number) {
                analytics_track_event('Tools', 'SearchByPhoto', "yugioh-cards_Redirect_To_Search");
                document.location.href = "/search-products?q=" + encodeURIComponent(response.number) + "&type=prices";
                return;
            }
        }
        if (response.answer_count === undefined) {
            $("#js-processing").hide();
            $('#search-by-photo-error').html(response.error);
            $('#search-by-photo-error').show();
            return;
        }
        if (response.answer_count === 0) {
            $("#js-processing").hide();
            $('#search-by-photo-error').html("No cards with that category and language");
            $('#search-by-photo-error').show();
            return;
        }
        var best_distance = 0;
        var _loop_1 = function () {
            if (!response.answer_records) {
                $("#js-processing").hide();
                return "break";
            }
            if (response.answer_records[i]) {
                $("#js-processing").hide();
                $(".search-by-photo-results p.header").show();
                $(".search-by-photo-results").show();
                $("#examples").hide();
                $('#search-by-photo-error').hide();
                if (response.answer_distances.length >= 1 && best_distance == 0) {
                    best_distance = response.answer_distances[0];
                    if (best_distance >= 0.7) {
                        $('#poor-results').show();
                    }
                }
                var setField = response.answer_records[i].set;
                var nameField = response.answer_records[i].name;
                var imgUrl = response.answer_records[i]._url;
                if (imgUrl === undefined) {
                    imgUrl = response.answer_records[i].image_url;
                }
                var productID = response.answer_records[i].product_id;
                $(results[i]).css("display", "inline-block");
                var href_1 = "/game/" + productID.replace(/^(G)/, "");
                $(results[i])
                    .find("a.item")
                    .attr("href", href_1)
                    .click(function (event) {
                    event.preventDefault();
                    if (srcImgID) {
                        var xhr = new XMLHttpRequest();
                        xhr.open("DELETE", "/src-img/" + srcImgID, true);
                        xhr.send();
                    }
                    window.location.href = href_1;
                });
                $(results[i])
                    .find("img")
                    .attr("src", "" + imgUrl.replace(/(1600.jpg)/, "240.jpg"));
                $(results[i])
                    .find("img")
                    .attr("title", nameField);
                $(results[i]).find("p.name").text(nameField);
                $(results[i])
                    .find("p.name")
                    .attr("title", nameField);
                var category_1 = $("#js-photo-category").val();
                if (category_1 !== "comic-books") {
                    $(results[i]).find("p.set").text(setField);
                    $(results[i])
                        .find("p.set")
                        .attr("title", setField);
                }
                if (category_1 === "sports-cards") {
                    var noParallel = nameField.replace(/\[.*?\]/g, '').replace(/#/g, '');
                    var baseUrl = "https://www.sportscardspro.com/search-products";
                    var searchQuery = noParallel.trim() + " " + setField.trim();
                    var formattedQuery = searchQuery.replace(/[\s]+/g, "+");
                    var searchUrl_1 = baseUrl + "?q=" + formattedQuery + "&type=prices&exclude-variants=false";
                    $(results[i])
                        .find("a.search")
                        .attr("href", searchUrl_1)
                        .click(function (event) {
                        event.preventDefault();
                        if (srcImgID) {
                            var xhr = new XMLHttpRequest();
                            xhr.open("DELETE", "/src-img/" + srcImgID, true);
                            xhr.send();
                        }
                        window.location.href = searchUrl_1;
                    });
                }
                else {
                    $(results[i])
                        .find("a.search")
                        .css("display", "none");
                }
            }
        };
        for (var i = 0; i < 5; i++) {
            var state_1 = _loop_1();
            if (state_1 === "break")
                break;
        }
    }
    function clearResults() {
        var results = $("div.result");
        for (var i = 0; i < results.length; i++) {
            $(results[i]).css("display", "none");
            $(results[i]).find("img").attr("src", "");
            $(results[i]).find("p.set").text("");
            $(results[i]).find("p.name").text("");
        }
    }
    function implement_dialogs() {
        var windowWidth = $(window).width();
        var dialogWidth = windowWidth * 0.9;
        var dialogEl = $(".js-show-search-by-photo-dialog");
        dialogEl.click(function (e) {
            e.preventDefault();
            $("#js-dialog-search-by-photo").dialog({
                position: { my: "top", at: "top+30", of: window },
                modal: true,
                minWidth: dialogWidth,
            });
            $('#file-upload').trigger('click');
        });
    }
    function implement_photo_item_click() {
        $('div.result a.item').click(function () {
            var category = $("#js-photo-category").val();
            var result = $(this).data("result");
            var label = category + "_Clicked_" + result;
            analytics_track_event('Tools', 'SearchByPhoto', label);
        });
        $('div.result a.search').click(function () {
            var category = $("#js-photo-category").val();
            var result = $(this).data("result");
            var label = category + "_Clicked_More_" + result;
            analytics_track_event('Tools', 'SearchByPhoto', label);
        });
    }
})(SearchByPhoto || (SearchByPhoto = {}));
var firebaseRef;
var snipe_message_version = 1005;
var snipePageLoaded = (new Date()).getTime();
var snipe_deals_weve_seen = {};
function implement_bin_sniping() {
    reconnect_channel();
    setting_desktop_notifications();
    setting_console_filter();
    setting_minimum_savings_dollars();
    setting_minimum_savings_percent();
    setting_adjust_for_shipping();
    setting_deal_type();
    want_to_see_tour("snipe.tour");
    snipe_tour();
    on_channel_message({
        version: 0,
        listing_type: 2,
        uid: "G6910",
        is_sample: true,
        item_id: "1234567890",
        price: new Currency(300),
        savings: new Currency(500),
        estimated: new Currency(800),
        shipping_cost: new Currency(0),
        category: "basketball-cards",
        condition: Condition.Cib,
        product_name: "Example Item",
        console_id: "G1304",
        title: "Real listings will appear as sellers list them.  Usually 3-5 minutes at most."
    });
}
function setting_desktop_notifications() {
    var notification_checkbox = $(".js-snipe-desktop-notifications");
    var uncheck = function () { return notification_checkbox.prop("checked", false); };
    if (Notify.needsPermission) {
        if (Notify.isSupported()) {
            Notify.requestPermission(function () { return true; }, uncheck);
        }
        else {
            uncheck();
        }
    }
    notification_checkbox.click(function () {
        var checked = notification_checkbox.is(":checked");
        preference_set('SnipeDesktopNotifications', "" + checked);
        analytics_track_event('Tools', 'BinSniper', 'Desktop_Notification_' + checked);
        if (checked) {
            if (Notify.needsPermission) {
                Notify.requestPermission(function () { return true; }, uncheck);
                var n = new Notify("Notifications enabled", { timeout: 5 * 1000 });
                n.show();
            }
        }
    });
    notification_checkbox.prop('checked', false);
    var pref = preference_get('SnipeDesktopNotifications') == "true";
    if (pref) {
        notification_checkbox.click();
    }
}
function setting_console_filter() {
    implement_console_selection_widget({
        maximum_consoles_to_render: 2,
        display_method: 1,
        retain_selected_consoles: true
    });
    $('.js-consoles-trigger').click(function () {
        analytics_track_event('Tools', 'BinSniper', 'Filter_Console');
    });
}
function setting_minimum_savings_dollars() {
    var pref = preference_get('SnipeMinimumSavingsDollars');
    var amount = new Currency(parseInt(pref, 10) || 500);
    var input = $('.js-minimum-savings-dollars');
    input.val(amount.toString());
    input.click(function (e) {
        e.preventDefault();
        $(this).focus().select();
    });
    input.change(function (e) {
        var amount = get_minimum_savings_dollars_from_dom();
        preference_set('SnipeMinimumSavingsDollars', "" + amount.pennies);
        input.val(amount.toString());
        input.blur();
        analytics_track_event('Tools', 'BinSniper', 'Filter_Savings_Dollar');
        toast("Changed minimum savings preference");
        e.preventDefault();
    });
}
function get_minimum_savings_dollars_from_dom() {
    var input = $('.js-minimum-savings-dollars');
    var raw_amount = (input.val());
    var amount = Currency.fromString(raw_amount);
    return amount;
}
function setting_minimum_savings_percent() {
    var pref = preference_get('SnipeMinimumSavingsPercent');
    var amount = parseInt(pref, 10) || 0;
    var input = $('.js-minimum-savings-percent');
    input.val(format_percent(amount));
    input.click(function (e) {
        e.preventDefault();
        $(this).focus().select();
    });
    input.change(function (e) {
        var amount = get_minimum_savings_percent_from_dom();
        if (amount === undefined) {
            alert("Invalid percentage.  You need something like 20%");
            return;
        }
        preference_set('SnipeMinimumSavingsPercent', "" + amount);
        input.val(format_percent(amount));
        input.blur();
        analytics_track_event('Tools', 'BinSniper', 'Filter_Savings_Percent');
        toast("Changed minimum savings percentage preference");
        e.preventDefault();
    });
}
function get_minimum_savings_percent_from_dom() {
    var input = $('.js-minimum-savings-percent');
    var raw_amount = (input.val());
    if (raw_amount == "")
        return 0;
    var amount = parseFloat(raw_amount);
    if (isNaN(amount))
        return undefined;
    if (amount < 1)
        amount = amount * 100;
    amount = Math.round(amount);
    return amount;
}
function format_percent(val) {
    if (val == 0)
        return "";
    return "" + val + "%";
}
function setting_adjust_for_shipping() {
    var pref = preference_get('SnipeAdjustForShipping') == "true";
    var input = $('.js-snipe-adjust-for-shipping');
    input.prop('checked', pref);
    input.click(function () {
        var checked = input.is(":checked");
        preference_set('SnipeAdjustForShipping', "" + checked);
    });
}
function setting_deal_type() {
    var types = ['Bin', 'Auction', 'Pcm', 'Used', 'Cib', 'New', 'Graded', 'BoxOnly', 'ManualOnly'];
    for (var i = 0; i < types.length; i++) {
        (function () {
            var type = types[i];
            var raw_pref = preference_get('SnipeShowDeal' + type);
            var pref = raw_pref === undefined || raw_pref == "true";
            var input = $('.js-snipe-show-' + type.toLowerCase());
            input.prop('checked', pref);
            input.click(function () {
                var checked = input.is(":checked");
                preference_set('SnipeShowDeal' + type, "" + checked);
            });
        })();
    }
}
function category_chosen() {
    var category = $('#js-category').data('category');
    return category;
}
function get_minimum_savings_pennies() {
    var pref = preference_get('SnipeMinimumSavingsDollars');
    var amount = parseInt(pref, 10);
    if (!amount) {
        var c = get_minimum_savings_dollars_from_dom();
        amount = c.pennies;
        if (!amount) {
            amount = 500;
        }
    }
    return amount;
}
function get_minimum_savings_percent() {
    var pref = preference_get('SnipeMinimumSavingsPercent');
    var amount = parseInt(pref, 10);
    if (isNaN(amount)) {
        amount = get_minimum_savings_percent_from_dom();
        if (amount === undefined) {
            amount = 0;
        }
    }
    return amount;
}
function wants_shipping_adjustment() {
    return $('.js-snipe-adjust-for-shipping').is(":checked");
}
function wants_to_see_listing(listing_type) {
    var name;
    switch (listing_type) {
        case 1:
            name = "auction";
            break;
        case 2:
            name = "bin";
            break;
        case 3:
            name = "pcm";
            break;
    }
    return $('.js-snipe-show-' + name).is(":checked");
}
function wants_to_see_condition(listing_type) {
    var name;
    switch (listing_type) {
        case Condition.Loose:
            name = "used";
            break;
        case Condition.Cib:
            name = "cib";
            break;
        case Condition.New:
            name = "new";
            break;
        case Condition.GradedNew:
            name = "graded";
            break;
        case Condition.BoxOnly:
            name = "boxonly";
            break;
        case Condition.ManualOnly:
            name = "manualonly";
            break;
    }
    return $('.js-snipe-show-' + name).is(":checked");
}
function reconnect_channel() {
    firebaseRef.on('child_added', function (snapshot, _) {
        on_channel_message(snapshot.val());
    });
    firebase.database().ref(".info/connected").on("value", function (snapshot) {
        if (snapshot.val() === true) {
            on_channel_opened();
        }
        else {
            on_channel_close();
        }
    });
    return;
}
function on_channel_opened() {
    change_channel_status("connected");
}
function on_channel_message(msg) {
    var deal = msg;
    var x = msg;
    if (typeof (x["condition"]) == "string") {
        deal.condition = condition_from_string(x["condition"]);
        deal.estimated = new Currency(x["estimated"]);
        deal.price = new Currency(x["price"]);
        deal.savings = new Currency(x["savings"]);
        deal.shipping_cost = new Currency(x["shipping_cost"]);
        switch (x["listing_type"]) {
            case "auction":
                deal.listing_type = 1;
                break;
            case "bin":
                deal.listing_type = 2;
                break;
            case "pcm":
                deal.listing_type = 3;
                break;
        }
    }
    var is_sample = deal.is_sample;
    if (deal.version > snipe_message_version) {
        window.location.reload();
        return;
    }
    if (!is_sample) {
        change_channel_status("connected");
    }
    if (snipe_deals_weve_seen[deal.item_id]) {
        return;
    }
    snipe_deals_weve_seen[deal.item_id] = true;
    var domain = "pricecharting";
    if (window.location.hostname.indexOf("sportscardspro") !== -1) {
        domain = "sportscardspro";
    }
    var category_wanted = category_chosen();
    if (!is_sample && category_wanted !== "all") {
        if (category_wanted !== deal.category) {
            return;
        }
    }
    else if (!is_sample && domain == "pricecharting") {
        switch (deal.category) {
            case "video-games":
            case "coins":
            case "comic-books":
            case "pokemon-cards":
            case "magic-cards":
            case "yugioh-cards":
            case "lego-sets":
                break;
            default:
                return;
        }
    }
    else if (!is_sample && domain == "sportscardspro") {
        switch (deal.category) {
            case "baseball-cards":
            case "basketball-cards":
            case "football-cards":
            case "hockey-cards":
            case "soccer-cards":
                break;
            default:
                return;
        }
    }
    var console_id = deal.console_id;
    if (console_id) {
        var matches = console_id.match(/^G(\d+)/);
        if (matches) {
            var wants_this_console = false;
            console_id = matches[1];
            var selected = get_selected_console_ids();
            for (var i = 0; i < selected.length; i++) {
                if (selected[i] == console_id) {
                    wants_this_console = true;
                    break;
                }
            }
            if (selected.length === 0) {
                wants_this_console = true;
            }
            if (!wants_this_console)
                return;
        }
    }
    var listing_type = deal.listing_type;
    if (!is_sample && !wants_to_see_listing(listing_type)) {
        return;
    }
    var condition = deal.condition;
    if (!is_sample && !wants_to_see_condition(condition)) {
        return;
    }
    if (deal.shipping_cost !== undefined && wants_shipping_adjustment()) {
        var shipping_cost = deal.shipping_cost;
        deal.price = deal.price.plus(shipping_cost);
        deal.savings = deal.savings.minus(shipping_cost);
    }
    var price = deal.price;
    var savings = deal.savings;
    var estimated = deal.estimated;
    if (!is_sample && savings.pennies < get_minimum_savings_pennies()) {
        return;
    }
    var savings_percentage = (savings.pennies / estimated.pennies) * 100;
    if (!is_sample && savings_percentage < get_minimum_savings_percent()) {
        return;
    }
    deal.product_id = parseInt(deal['uid'].match(/G(\d+)/)[1], 10);
    if (domain == "sportscardspro") {
        deal.affiliate_link = affiliate_link(3, deal.product_id, deal.item_id);
    }
    else {
        deal.affiliate_link = affiliate_link(2, deal.product_id, deal.item_id);
    }
    switch (deal.condition) {
        case Condition.Loose:
            deal["condition_name"] = "used";
            break;
        case Condition.Cib:
            deal["condition_name"] = "cib";
            break;
        case Condition.New:
            deal["condition_name"] = "new";
            break;
        case Condition.GradedNew:
            deal["condition_name"] = "graded";
            break;
        case Condition.BoxOnly:
            deal["condition_name"] = "boxonly";
            break;
        case Condition.ManualOnly:
            deal["condition_name"] = "manualonly";
            break;
    }
    switch (deal.listing_type) {
        case 1:
            deal["listing_type_name"] = "auction";
            break;
        case 2:
            deal["listing_type_name"] = "bin";
            break;
        case 3:
            deal["listing_type_name"] = "pcm";
            break;
    }
    var html = templates["snipe"].render(deal);
    $('.js-snipe-deals-body').prepend(html);
    $('.js-snipe-deal').filter(":first")['effect']('highlight', 1500);
    if (is_sample) {
        return;
    }
    if (wants_desktop_notifications()) {
        show_notification(deal.price + " -> " + deal.title, {
            icon: deal.picture_url.replace('http://', 'https://'),
            timeout: 7000
        });
    }
    $(".js-snipe-deal-sample").remove();
    trim_snipe_deals_table();
}
var notification_passthrough_option = {
    "body": true,
    "dir": true,
    "icon": true,
    "lang": true,
    "tag": true,
};
function show_notification(title, user_options) {
    var options = {};
    for (var key_2 in user_options) {
        if (notification_passthrough_option[key_2]) {
            options[key_2] = user_options[key_2];
        }
    }
    var noop = function () { };
    options['timeout'] = user_options['timeout'] || 10 * 1000;
    options['closeOnClick'] = true;
    options['notifyClick'] = on_notification_click;
    var n = new Notify(title, options);
    n.show();
}
function on_notification_click() {
    parent.focus();
    window.focus();
}
function on_channel_error(err) {
    change_channel_status("disconnected");
}
function on_channel_close() {
    var now = (new Date()).getTime();
    if ((now - snipePageLoaded) < 5 * 1000)
        return;
    analytics_track_event('Tools', 'BinSniper', 'Disconnected');
    change_channel_status("disconnected");
}
function change_channel_status(new_status) {
    var statuses = {
        "connecting": true,
        "connected": true,
        "disconnected": true
    };
    for (var status in statuses) {
        if (statuses.hasOwnProperty(status)) {
            if (new_status == status) {
                $(".js-snipe-" + status).show();
            }
            else {
                $(".js-snipe-" + status).hide();
            }
        }
    }
}
function wants_desktop_notifications() {
    if (Notify.needsPermission)
        return false;
    return $(".js-snipe-desktop-notifications:checked").length > 0;
}
function trim_snipe_deals_table() {
    var deals = $(".js-snipe-deal");
    for (var i = 0; i < deals.length; i++) {
        if (i > 20) {
            deals[i].remove();
        }
    }
}
function snipe_tour() {
    $("#js-tour0").click(function (e) {
        analytics_track_event("Tools", "BinSniper", "Started Tour");
        $("#js-tour1").show();
        e.preventDefault();
    });
    $("#js-tour1 > a").click(function (e) {
        $("#js-tour1").hide();
        $("#js-tour2").show();
        e.preventDefault();
    });
    $("#js-tour2 > a").click(function (e) {
        $("#js-tour2").hide();
        $("#js-tour3").show();
        e.preventDefault();
    });
    $("#js-tour3 > a").click(function (e) {
        $("#js-tour3").hide();
        $("#js-tour4").show();
        e.preventDefault();
    });
    $("#js-tour4 > a").click(function (e) {
        $("#js-tour4").hide();
        $("#js-tour5").show();
        e.preventDefault();
    });
    $("#js-tour5 > a").click(function (e) {
        $("#js-tour5").hide();
        $("#js-tour6").show();
        e.preventDefault();
    });
    $("#js-tour6 > a").click(function (e) {
        $("#js-tour6").hide();
        $("#js-tour7").show();
        e.preventDefault();
    });
    $("#js-tour7 > a").click(function (e) {
        $("#js-tour7").hide();
        e.preventDefault();
    });
}
function implement_faq() {
    $('.js-open-faq').click(function (e) {
        $('.js-faq').dialog({
            'modal': true,
            'width': 760,
            'height': 760
        });
        e.preventDefault();
    });
}
function hash_name_for(tab) {
    switch (tab) {
        case 0:
            return 'completed-auctions';
        case 9:
            return 'completed-auctions-used';
        case 8:
            return 'completed-auctions-new';
        case 2:
            return 'completed-auctions-cib';
        case 3:
            return 'completed-auctions-graded';
        case 1:
            return 'completed-auctions-box-only';
        case 7:
            return 'completed-auctions-manual-only';
        case 10:
            return 'completed-auctions-loose-and-box';
        case 11:
            return 'completed-auctions-loose-and-manual';
        case 12:
            return 'completed-auctions-box-and-manual';
        case 13:
            return 'completed-auctions-grade-three';
        case 4:
            return 'completed-auctions-grade-four';
        case 5:
            return 'completed-auctions-grade-five';
        case 6:
            return 'completed-auctions-grade-six';
        case 16:
            return 'completed-auctions-grade-seventeen';
        case 17:
            return 'completed-auctions-grade-eighteen';
        case 18:
            return 'completed-auctions-grade-nineteen';
        case 19:
            return 'completed-auctions-grade-twenty';
        case 20:
            return 'completed-auctions-grade-twenty-one';
        case 21:
            return 'completed-auctions-grade-twenty-two';
        case 14:
            return 'population-report';
        case 15:
            return 'used-prices';
    }
    throw "Unhandled tab: " + tab;
}
function implement_tabs() {
    var tabs = [
        0,
        9,
        8,
        2,
        3,
        1,
        7,
        10,
        11,
        12,
        13,
        4,
        5,
        6,
        16,
        17,
        18,
        19,
        20,
        21,
        14,
        15,
    ];
    tabs.forEach(function (tab) {
        var name = hash_name_for(tab);
        $('#tab-bar .tab.' + name).click(function (e) {
            var clickedElement = e.target.tagName;
            if (clickedElement == "SELECT") {
                record_analytics_tab_pageview();
                select_tab_with_no_location_change(tab);
                e.stopPropagation();
            }
            else {
                select_tab_with_location_change(tab);
                e.stopPropagation();
            }
        });
    });
    $('.js-show-tab a').click(function (e) {
        e.preventDefault();
        var tab_name = ($(e.target).closest('*[data-show-tab]').data('show-tab'));
        var tab = get_tab_by_name(tab_name);
        change_sales_dropdown_to(tab);
        record_analytics_tab_pageview();
        select_tab_with_location_change(tab);
    });
    auto_select_tab_from_url();
    preference_selected_tab();
}
function record_analytics_tab_pageview() {
    var selected = $('#completed-auctions-condition').val();
    var hash = hash_name_for(get_tab_by_name(selected));
    gtag('config', ga4_tag_id, { page_location: '/game-tab/' + hash });
}
function select_tab_with_no_location_change(tab) {
    select_tab(tab);
}
function select_tab_with_location_change(tab) {
    select_tab(tab);
    var hash = hash_name_for(tab);
    window.location.hash = hash;
}
function select_tab(tab) {
    var hash = hash_name_for(tab);
    if ($('#tab-bar .tab.' + hash).length) {
        $('#tab-bar .tab.selected').removeClass('selected').addClass('available');
        $('#tab-bar .tab.' + hash).removeClass('available').addClass('selected');
        if (hash !== "completed-auctions") {
            $("#completed-auctions-condition option:selected").prop("selected", false);
        }
        $('.tab-frame').children().hide();
        $('.tab-frame .' + hash).show();
        localStorage['prefs.game.tab'] = hash;
    }
    if (~hash.indexOf('completed-auctions')) {
        var dropValue = $('#tab-bar .tab #completed-auctions-condition').val();
        if (dropValue !== null && dropValue !== "") {
            $('#tab-bar .tab.selected').removeClass('selected').addClass('available');
            $('#tab-bar .tab.completed-auctions').removeClass('available').addClass('selected');
            var selected = dropValue;
            tab = get_tab_by_name(selected);
            hash = hash_name_for(tab);
            $('.tab-frame').children().hide();
            $('.tab-frame .' + hash).show();
            localStorage['prefs.game.tab'] = hash;
        }
    }
}
function set_content_for_tab(tab, html) {
    $('.tab-frame .' + hash_name_for(tab)).html(html);
}
function preference_selected_tab() {
    var pref = localStorage['prefs.game.tab'];
    if (pref === null) {
        return;
    }
    var tab = get_tab_by_name(pref);
    change_sales_dropdown_to(tab);
    select_tab_with_no_location_change(tab);
}
function auto_select_tab_from_url() {
    var hash = get_url_hash();
    if (!hash)
        return;
    var tab = get_tab_by_name(hash);
    if (!tab) {
        analytics_track_event('Clicks', 'GamePage', hash);
        return;
    }
    change_sales_dropdown_to(tab);
    select_tab_with_location_change(tab);
}
function get_url_hash() {
    return window.location.hash.substr(1);
}
function get_tab_by_name(name) {
    switch (name) {
        case 'used-prices':
            return 15;
        case 'completed-auctions':
            return 0;
        case 'completed-auctions-used':
            return 9;
        case 'completed-auctions-cib':
            return 2;
        case 'completed-auctions-new':
            return 8;
        case 'completed-auctions-graded':
            return 3;
        case 'completed-auctions-box-only':
            return 1;
        case 'completed-auctions-manual-only':
            return 7;
        case 'completed-auctions-loose-and-box':
            return 10;
        case 'completed-auctions-loose-and-manual':
            return 11;
        case 'completed-auctions-box-and-manual':
            return 12;
        case 'completed-auctions-grade-three':
            return 13;
        case 'completed-auctions-grade-four':
            return 4;
        case 'completed-auctions-grade-five':
            return 5;
        case 'completed-auctions-grade-six':
            return 6;
        case 'completed-auctions-grade-seventeen':
            return 16;
        case 'completed-auctions-grade-eighteen':
            return 17;
        case 'completed-auctions-grade-nineteen':
            return 18;
        case 'completed-auctions-grade-twenty':
            return 19;
        case 'completed-auctions-grade-twenty-one':
            return 20;
        case 'completed-auctions-grade-twenty-two':
            return 21;
        case 'population-report':
            return 14;
        case 'full-prices':
            return;
        case 'itemdetails':
            return;
        case 'images':
            return;
        default:
            console.log("Unknown tab name: " + name);
            return 9;
    }
}
function get_tab(tab) {
    var name = hash_name_for(tab);
    return $('#tab-bar .tab.' + name);
}
if (!!!templates)
    var templates = {};
templates["calculator-row"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr id=\""); t.b(t.v(t.f("uuid", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("    <td>"); t.b("\n" + i); t.b("        <a href=\"/game/"); t.b(t.v(t.f("id", c, p, 0))); t.b("\" target=\"_blank\">"); t.b(t.v(t.f("product_name", c, p, 0))); t.b("</a>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"console\">"); t.b(t.v(t.f("console_name", c, p, 0))); t.b("</td>"); t.b("\n" + i); t.b("    <td class=\"condition\">"); t.b("\n" + i); t.b("    <select>"); t.b("\n" + i); if (t.s(t.f("is_a_card", c, p, 1), c, p, 0, 210, 688, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 247, 256, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 322, 331, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded 7</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 395, 404, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded 8</option>"); t.b("\n" + i); t.b("        <option value=5"); if (t.s(t.f("is_graded", c, p, 1), c, p, 0, 471, 480, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded 9</option>"); t.b("\n" + i); t.b("        <option value=6"); if (t.s(t.f("is_boxonly", c, p, 1), c, p, 0, 551, 560, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded 9.5</option>"); t.b("\n" + i); t.b("        <option value=7"); if (t.s(t.f("is_manualonly", c, p, 1), c, p, 0, 637, 646, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded 10</option>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("is_videogame", c, p, 1), c, p, 0, 724, 1187, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 761, 770, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Loose</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 833, 842, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">CIB</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 901, 910, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">New</option>"); t.b("\n" + i); t.b("        <option value=5"); if (t.s(t.f("is_graded", c, p, 1), c, p, 0, 972, 981, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Graded</option>"); t.b("\n" + i); t.b("        <option value=6"); if (t.s(t.f("is_boxonly", c, p, 1), c, p, 0, 1050, 1059, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Box Only</option>"); t.b("\n" + i); t.b("        <option value=7"); if (t.s(t.f("is_manualonly", c, p, 1), c, p, 0, 1134, 1143, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Manual Only</option>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("is_comic", c, p, 1), c, p, 0, 1222, 1672, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 1259, 1268, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 1334, 1343, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">4.0</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 1402, 1411, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">6.0</option>"); t.b("\n" + i); t.b("        <option value=5"); if (t.s(t.f("is_graded", c, p, 1), c, p, 0, 1473, 1482, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">8.0</option>"); t.b("\n" + i); t.b("        <option value=6"); if (t.s(t.f("is_boxonly", c, p, 1), c, p, 0, 1548, 1557, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">9.2</option>"); t.b("\n" + i); t.b("        <option value=7"); if (t.s(t.f("is_manualonly", c, p, 1), c, p, 0, 1627, 1636, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">9.8</option>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("is_a_funko", c, p, 1), c, p, 0, 1705, 1927, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 1742, 1751, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Loose</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 1814, 1823, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">In Dmg Box</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 1889, 1898, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">New</option>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("is_a_lego", c, p, 1), c, p, 0, 1961, 2184, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 1998, 2007, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Pieces only</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 2076, 2085, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Boxed</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 2146, 2155, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">New</option>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("is_a_coin", c, p, 1), c, p, 0, 2217, 2668, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <option value=1"); if (t.s(t.f("is_loose", c, p, 1), c, p, 0, 2254, 2263, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("        <option value=3"); if (t.s(t.f("is_cib", c, p, 1), c, p, 0, 2329, 2338, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">VF</option>"); t.b("\n" + i); t.b("        <option value=2"); if (t.s(t.f("is_new", c, p, 1), c, p, 0, 2396, 2405, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">AU</option>"); t.b("\n" + i); t.b("        <option value=5"); if (t.s(t.f("is_graded", c, p, 1), c, p, 0, 2466, 2475, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">MS62</option>"); t.b("\n" + i); t.b("        <option value=6"); if (t.s(t.f("is_boxonly", c, p, 1), c, p, 0, 2542, 2551, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">MS64</option>"); t.b("\n" + i); t.b("        <option value=7"); if (t.s(t.f("is_manualonly", c, p, 1), c, p, 0, 2622, 2631, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" selected"); });
            c.pop();
        } t.b(">MS66</option>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </select>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"numeric price\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td><a href=\"#\" class=\"remove no-print\">X</a></td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["calculator-suggestion"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<li>"); t.b("\n" + i); t.b("    <a>"); t.b(t.v(t.f("product_name", c, p, 0))); t.b(" &mdash; "); t.b(t.v(t.f("console_name", c, p, 0))); t.b("</a>"); t.b("\n" + i); t.b("</li>"); return t.fl(); }, partials: {}, subs: {} });
templates["console-grid"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<div class=\"item\" id=\"product-"); t.b(t.v(t.f("id", c, p, 0))); t.b("\" data-product=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); if (t.s(t.f("showCoverArt", c, p, 1), c, p, 0, 82, 314, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("    <div class=\"cover\">"); t.b("\n" + i); t.b("        <div>"); t.b("\n" + i); t.b("            <a href=\"/game/"); t.b(t.v(t.f("consoleUri", c, p, 0))); t.b("/"); t.b(t.v(t.f("productUri", c, p, 0))); t.b("\" title=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                <img class=\"photo\" loading=\"lazy\" src=\""); t.b(t.v(t.f("imageUri", c, p, 0))); t.b("\" />"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </div>"); t.b("\n" + i); });
        c.pop();
    } t.b("    <div class=\"title\" title=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("        <a href=\"/game/"); t.b(t.v(t.f("consoleUri", c, p, 0))); t.b("/"); t.b(t.v(t.f("productUri", c, p, 0))); t.b("\">"); t.b(t.v(t.f("productName", c, p, 0))); t.b("</a>"); t.b("\n" + i); if (t.s(t.f("printRun", c, p, 1), c, p, 0, 466, 573, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <span class=\"list-print-run\" title=\""); t.b(t.v(t.f("printRun", c, p, 0))); t.b(" copies printed\">/"); t.b(t.v(t.f("printRun", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </div>"); t.b("\n" + i); t.b("    <div class=\"price used-price\">"); t.b("\n" + i); if (t.s(t.f("isVideoGame", c, p, 1), c, p, 0, 661, 703, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Loose Price:"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isFunko", c, p, 1), c, p, 0, 744, 785, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Out of Box:"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isCard", c, p, 1), c, p, 0, 821, 860, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Ungraded:"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isComic", c, p, 1), c, p, 0, 896, 935, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Ungraded:"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isCoin", c, p, 1), c, p, 0, 971, 1010, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Ungraded:"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isLego", c, p, 1), c, p, 0, 1045, 1087, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                Pieces Only:"); t.b("\n" + i); });
        c.pop();
    } t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price1", c, p, 0))); t.b("</span>"); t.b("\n" + i); if (t.s(t.f("isDollarChangeSort", c, p, 1), c, p, 0, 1179, 1319, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <span class=\"change\">"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("priceChangeSign", c, p, 0))); t.b("<span class=\"js-price\">"); t.b(t.v(t.f("priceChange", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("            </span>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isPercentChangeSort", c, p, 1), c, p, 0, 1375, 1509, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <span class=\"change\">"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("priceChangeSign", c, p, 0))); t.b("<span>"); t.b(t.v(t.f("priceChangePercentage", c, p, 0))); t.b("%</span>"); t.b("\n" + i); t.b("            </span>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </div>"); t.b("\n" + i); t.b("    <div class=\"add_to container\">"); t.b("\n" + i); t.b("        <ul class=\"add_to collection\" data-product-id=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("            <li class=\"add_to collection\">"); t.b("\n" + i); if (t.s(t.f("hasProduct", c, p, 1), c, p, 0, 1714, 1882, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                <a href=\"/my-collection?product="); t.b(t.v(t.f("id", c, p, 0))); t.b("\" class=\"orange button small\" rel=\"nofollow\">"); t.b("\n" + i); t.b("                    in Collection"); t.b("\n" + i); t.b("                </a>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("hasProduct", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("                <ul class=\"list\">");
        t.b("\n" + i);
        t.b("                    <li class=\"list-item\">");
        t.b("\n" + i);
        t.b("                        <a href=\"#\" class=\"js-add-one-click\" data-product-id=\"");
        t.b(t.v(t.f("id", c, p, 0)));
        t.b("\" rel=\"nofollow\">");
        t.b("\n" + i);
        t.b("                            In One Click");
        t.b("\n" + i);
        t.b("                        </a>");
        t.b("\n" + i);
        t.b("                    </li>");
        t.b("\n" + i);
        t.b("                    <li class=\"list-item\">");
        t.b("\n" + i);
        t.b("                        <a href=\"/publish-offer?product=");
        t.b(t.v(t.f("id", c, p, 0)));
        t.b("&add-to-collection=1\" rel=\"nofollow\">");
        t.b("\n" + i);
        t.b("                            With Details");
        t.b("\n" + i);
        t.b("                        </a>");
        t.b("\n" + i);
        t.b("                    </li>");
        t.b("\n" + i);
        t.b("                </ul>");
        t.b("\n" + i);
        t.b("                <span class=\"blue button small\">");
        t.b("\n" + i);
        t.b("                    &#43; Collection");
        t.b("\n" + i);
        t.b("                </span>");
        t.b("\n" + i);
    } ; t.b("            </li>"); t.b("\n" + i); t.b("        </ul>"); t.b("\n" + i); t.b("        <ul class=\"add_to wishlist\" data-product-id=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("            <li class=\"add_to wishlist\">"); t.b("\n" + i); if (t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 0, 2770, 3360, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                <ul class=\"list\" data-product-id=\""); t.b(t.v(t.d(".Id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                    <li class=\"list-item\">"); t.b("\n" + i); t.b("                        <a href=\"#\" class=\"js-add-bid\">"); t.b("\n" + i); t.b("                            &#43; Another"); t.b("\n" + i); t.b("                        </a>"); t.b("\n" + i); t.b("                    </li>"); t.b("\n" + i); t.b("                    <li class=\"list-item\">"); t.b("\n" + i); t.b("                        <a href=\"#\" class=\"js-cancel-bid\">"); t.b("\n" + i); t.b("                            Remove"); t.b("\n" + i); t.b("                        </a>"); t.b("\n" + i); t.b("                    </li>"); t.b("\n" + i); t.b("                </ul>"); t.b("\n" + i); t.b("                <span class=\"orange button small\">"); t.b("\n" + i); t.b("                    in Wishlist"); t.b("\n" + i); t.b("                </span>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("                <span class=\"blue button small js-add-bid\">&#43; Wishlist</span>");
        t.b("\n" + i);
    } ; t.b("            </li>"); t.b("\n" + i); t.b("        </ul>"); t.b("\n" + i); t.b("    </div>"); t.b("\n" + i); t.b("</div>"); return t.fl(); }, partials: {}, subs: {} });
templates["console-row"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr id=\"product-"); t.b(t.v(t.f("id", c, p, 0))); t.b("\" data-product=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); if (t.s(t.f("showCoverArt", c, p, 1), c, p, 0, 68, 298, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("    <td class=\"image\">"); t.b("\n" + i); t.b("        <div>"); t.b("\n" + i); t.b("            <a href=\"/game/"); t.b(t.v(t.f("consoleUri", c, p, 0))); t.b("/"); t.b(t.v(t.f("productUri", c, p, 0))); t.b("\" title=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                <img class=\"photo\" loading=\"lazy\" src=\""); t.b(t.v(t.f("imageUri", c, p, 0))); t.b("\" />"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); });
        c.pop();
    } t.b("    <td class=\"title\" title=\""); t.b(t.v(t.f("id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("        <a href=\"/game/"); t.b(t.v(t.f("consoleUri", c, p, 0))); t.b("/"); t.b(t.v(t.f("productUri", c, p, 0))); t.b("\">"); t.b(t.v(t.f("productName", c, p, 0))); t.b("</a>"); t.b("\n" + i); if (t.s(t.f("printRun", c, p, 1), c, p, 0, 449, 556, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <span class=\"list-print-run\" title=\""); t.b(t.v(t.f("printRun", c, p, 0))); t.b(" copies printed\">/"); t.b(t.v(t.f("printRun", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </td>"); t.b("\n" + i); if (t.s(t.f("isFunko", c, p, 1), c, p, 0, 596, 649, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("    <td class=\"price numeric funko_used_price\">"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("isFunko", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("    <td class=\"price numeric used_price\">");
        t.b("\n" + i);
    } ; t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price1", c, p, 0))); t.b("</span>"); t.b("\n" + i); if (t.s(t.f("isDollarChangeSort", c, p, 1), c, p, 0, 815, 939, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <span class=\"change\">"); t.b("\n" + i); t.b("        "); t.b(t.v(t.f("priceChangeSign", c, p, 0))); t.b("<span class=\"js-price\">"); t.b(t.v(t.f("priceChange", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("        </span>"); t.b("\n" + i); });
        c.pop();
    } if (t.s(t.f("isPercentChangeSort", c, p, 1), c, p, 0, 991, 1109, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <span class=\"change\">"); t.b("\n" + i); t.b("        "); t.b(t.v(t.f("priceChangeSign", c, p, 0))); t.b("<span>"); t.b(t.v(t.f("priceChangePercentage", c, p, 0))); t.b("%</span>"); t.b("\n" + i); t.b("        </span>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"price numeric cib_price\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price3", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); if (t.s(t.f("isFunko", c, p, 1), c, p, 0, 1260, 1370, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("    <td class=\"price numeric funko_new_price\">"); t.b("\n" + i); t.b("       <span class=\"js-price\">"); t.b(t.v(t.f("price2", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("isFunko", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("    <td class=\"price numeric new_price\">");
        t.b("\n" + i);
        t.b("       <span class=\"js-price\">");
        t.b(t.v(t.f("price2", c, p, 0)));
        t.b("</span>");
        t.b("\n" + i);
        t.b("    </td>");
        t.b("\n" + i);
    } ; t.b("    <td class=\"add_to container\">"); t.b("\n" + i); t.b("        <ul class=\"add_to collection\">"); t.b("\n" + i); t.b("            <li class=\"add_to collection\">"); t.b("\n" + i); if (t.s(t.f("hasProduct", c, p, 1), c, p, 0, 1663, 1862, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                <a href=\"/my-collection?product="); t.b(t.v(t.f("id", c, p, 0))); t.b("\" class=\"orange button small\">"); t.b("\n" + i); t.b("                    in<span class=\"small-desktop-hidden\"> Collection</span>"); t.b("\n" + i); t.b("                </a>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("hasProduct", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("                <ul class=\"list\">");
        t.b("\n" + i);
        t.b("                    <li class=\"list-item\">");
        t.b("\n" + i);
        t.b("                        <a href=\"#\" class=\"js-add-one-click\" data-product-id=\"");
        t.b(t.v(t.f("id", c, p, 0)));
        t.b("\">");
        t.b("\n" + i);
        t.b("                            <span class=\"small-desktop-visible\">&#43; Collection</span>");
        t.b("\n" + i);
        t.b("                            In One Click");
        t.b("\n" + i);
        t.b("                        </a>");
        t.b("\n" + i);
        t.b("                    </li>");
        t.b("\n" + i);
        t.b("                    <li class=\"list-item\">");
        t.b("\n" + i);
        t.b("                        <a href=\"/publish-offer?product=");
        t.b(t.v(t.f("id", c, p, 0)));
        t.b("&add-to-collection=1\">");
        t.b("\n" + i);
        t.b("                            <span class=\"small-desktop-visible\">&#43; Collection</span>");
        t.b("\n" + i);
        t.b("                            With Details");
        t.b("\n" + i);
        t.b("                        </a>");
        t.b("\n" + i);
        t.b("                    </li>");
        t.b("\n" + i);
        if (t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 0, 2613, 3075, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                        <li class=\"list-item\">"); t.b("\n" + i); t.b("                            <a href=\"#\" class=\"js-add-bid\">"); t.b("\n" + i); t.b("                                &#43; Wishlist Another"); t.b("\n" + i); t.b("                            </a>"); t.b("\n" + i); t.b("                        </li>"); t.b("\n" + i); t.b("                        <li class=\"list-item\">"); t.b("\n" + i); t.b("                            <a href=\"#\" class=\"js-cancel-bid\">"); t.b("\n" + i); t.b("                                - Wishlist"); t.b("\n" + i); t.b("                            </a>"); t.b("\n" + i); t.b("                        </li>"); t.b("\n" + i); });
            c.pop();
        }
        if (!t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 1, 0, 0, "")) {
            t.b("                    <li class=\"list-item small-desktop-visible-cell\">");
            t.b("\n" + i);
            t.b("                        <a href=\"#\" class=\"js-add-bid\">&#43; Wishlist</a>");
            t.b("\n" + i);
            t.b("                    </li>");
            t.b("\n" + i);
        }
        ;
        t.b("                </ul>");
        t.b("\n" + i);
        t.b("                <span class=\"blue button small");
        if (t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 0, 3448, 3455, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b(" orange"); });
            c.pop();
        }
        t.b("\">");
        t.b("\n" + i);
        t.b("                    &#43;<span class=\"small-desktop-hidden\"> Collection</span>");
        t.b("\n" + i);
        t.b("                </span>");
        t.b("\n" + i);
    } ; t.b("            </li>"); t.b("\n" + i); t.b("        </ul>"); t.b("\n" + i); t.b("        <ul class=\"add_to wishlist\" data-product-id=\""); t.b(t.v(t.d(".Id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("            <li class=\"add_to wishlist\">"); t.b("\n" + i); if (t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 0, 3791, 4487, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                    <ul class=\"list\" data-product-id=\""); t.b(t.v(t.d(".Id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                        <li class=\"list-item\">"); t.b("\n" + i); t.b("                            <a href=\"#\" class=\"js-add-bid\">"); t.b("\n" + i); t.b("                                &#43; Another"); t.b("\n" + i); t.b("                            </a>"); t.b("\n" + i); t.b("                        </li>"); t.b("\n" + i); t.b("                        <li class=\"list-item\">"); t.b("\n" + i); t.b("                            <a href=\"#\" class=\"js-cancel-bid\">"); t.b("\n" + i); t.b("                                Remove"); t.b("\n" + i); t.b("                            </a>"); t.b("\n" + i); t.b("                        </li>"); t.b("\n" + i); t.b("                    </ul>"); t.b("\n" + i); t.b("                    <span class=\"orange button small\">"); t.b("\n" + i); t.b("                        in<span class=\"small-desktop-hidden\"> Wishlist</span>"); t.b("\n" + i); t.b("                    </span>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("wishlistHasProduct", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("                <span class=\"blue button small js-add-bid\">&#43;<span class=\"small-desktop-hidden\"> Wishlist</span></span>");
        t.b("\n" + i);
    } ; t.b("            </li>"); t.b("\n" + i); t.b("        </ul>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["offers-buyer-item"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr class=\"offer \">"); t.b("\n" + i); t.b("    <td class=\"photo\">"); t.b("\n" + i); t.b("        <div>"); t.b("\n" + i); t.b("            <a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                <img src=\""); t.b(t.v(t.f("image-url", c, p, 0))); t.b("\" loading=lazy>"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"meta\">"); t.b("\n" + i); t.b("        <p class=\"order_date\">"); t.b("\n" + i); t.b("            <span>Bought: "); t.b(t.v(t.f("sale-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); if (t.s(t.f("is-refunded", c, p, 1), c, p, 0, 319, 403, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <br/>"); t.b("\n" + i); t.b("            <span>Refunded: "); t.b(t.v(t.f("refunded-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("is-refunded", c, p, 1), c, p, 1, 0, 0, "")) {
        if (t.s(t.f("is-shipped", c, p, 1), c, p, 0, 480, 646, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                    <br/>"); t.b("\n" + i); t.b("                    <span>Shipped: "); t.b(t.v(t.f("shipped-time", c, p, 0))); t.b(" "); if (t.s(t.f("tracking-number", c, p, 1), c, p, 0, 579, 602, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("( "); t.b(t.v(t.f("tracking-number", c, p, 0))); t.b(" )"); });
                c.pop();
            } t.b("</span>"); t.b("\n" + i); });
            c.pop();
        }
        t.b("\n" + i);
    } ; t.b("        </p>"); t.b("\n" + i); t.b("        <p class=\"title\">"); t.b("\n" + i); t.b("            <a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b(t.v(t.f("product-name", c, p, 0))); t.b("</a><br>"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("console-name", c, p, 0))); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("        <p class=\"includes\">"); t.b("\n" + i); t.b("            <span>Includes: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("include-string", c, p, 0))); t.b("<br>"); t.b("\n" + i); t.b("            <span>Condition: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("condition-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"price\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price-string", c, p, 0))); t.b("</p>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"links\">"); t.b("\n" + i); if (!t.s(t.f("buyer-left-feedback", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("        <a href=\"");
        t.b(t.v(t.f("offer-url", c, p, 0)));
        t.b("#feedback-form\">Leave feedback</a><br>");
        t.b("\n" + i);
    } ; t.b("        <a href=\"/offers?seller="); t.b(t.v(t.f("seller-id", c, p, 0))); t.b("\">More from Seller</a><br>"); t.b("\n" + i); t.b("        <a href=\"/publish-offer?product="); t.b(t.v(t.f("id", c, p, 0))); t.b("\">Sell It</a>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("</tr>"); t.b("\n"); t.b("\n" + i); t.b("<tr class=\"gap\">"); t.b("\n" + i); t.b("    <td colspan=\"3\"></td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["offers-collection-item"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr class=\"offer\" data-offer-id=\""); t.b(t.v(t.f("offer-id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("	<td class=\"photo\">"); t.b("\n" + i); t.b("		<div>"); t.b("\n" + i); t.b("			<a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("				<img src=\""); t.b(t.v(t.f("image-url", c, p, 0))); t.b("\" loading=lazy>"); t.b("\n" + i); t.b("			</a>"); t.b("\n" + i); t.b("		</div>"); t.b("\n" + i); t.b("	</td>"); t.b("\n" + i); t.b("	<td class=\"meta\">"); t.b("\n" + i); t.b("		<p class=\"title\">"); t.b("\n" + i); t.b("			<a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b(t.v(t.f("product-name", c, p, 0))); t.b("</a><br>"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("console-name", c, p, 0))); t.b("\n" + i); t.b("		</p>"); t.b("\n" + i); if (t.s(t.f("description", c, p, 1), c, p, 0, 322, 405, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <p class=\"notes\">"); t.b("\n" + i); t.b("            Notes: "); t.b(t.v(t.f("description", c, p, 0))); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); });
        c.pop();
    } t.b("	</td>"); t.b("\n" + i); t.b("    <td class=\"includes\">"); t.b("\n" + i); if (t.s(t.f("user-viewing-own-offers", c, p, 1), c, p, 0, 487, 9950, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <select name=\"condition-id\" id=\"js-condition-id\">"); t.b("\n" + i); if (t.s(t.f("is-card", c, p, 1), c, p, 0, 566, 2514, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 618, 626, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 719, 727, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PSA 10</option>"); t.b("\n" + i); t.b("            <option value=\"8\" "); if (t.s(t.f("is-condition-eight", c, p, 1), c, p, 0, 820, 828, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">BGS 10</option>"); t.b("\n" + i); t.b("            <option value=\"20\" "); if (t.s(t.f("is-condition-twenty", c, p, 1), c, p, 0, 923, 931, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">BGS 10 Black</option>"); t.b("\n" + i); t.b("            <option value=\"17\" "); if (t.s(t.f("is-condition-seventeen", c, p, 1), c, p, 0, 1036, 1044, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">CGC 10</option>"); t.b("\n" + i); t.b("            <option value=\"19\" "); if (t.s(t.f("is-condition-nineteen", c, p, 1), c, p, 0, 1145, 1153, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">CGC 10 Prist.</option>"); t.b("\n" + i); t.b("            <option value=\"18\" "); if (t.s(t.f("is-condition-eighteen", c, p, 1), c, p, 0, 1260, 1268, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">SGC 10</option>"); t.b("\n" + i); t.b("            <option value=\"21\" "); if (t.s(t.f("is-condition-twenty-one", c, p, 1), c, p, 0, 1370, 1378, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">TAG 10</option>"); t.b("\n" + i); t.b("            <option value=\"22\" "); if (t.s(t.f("is-condition-twenty-two", c, p, 1), c, p, 0, 1482, 1490, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">ACE 10</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 1586, 1594, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.5</option>"); t.b("\n" + i); t.b("            <option value=\"5\" "); if (t.s(t.f("is-condition-five", c, p, 1), c, p, 0, 1681, 1689, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 1774, 1782, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">8</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 1868, 1876, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">7</option>"); t.b("\n" + i); t.b("            <option value=\"16\" "); if (t.s(t.f("is-condition-sixteen", c, p, 1), c, p, 0, 1967, 1975, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">6</option>"); t.b("\n" + i); t.b("            <option value=\"15\" "); if (t.s(t.f("is-condition-fifteen", c, p, 1), c, p, 0, 2068, 2076, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">5</option>"); t.b("\n" + i); t.b("            <option value=\"14\" "); if (t.s(t.f("is-condition-fourteen", c, p, 1), c, p, 0, 2170, 2178, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">4</option>"); t.b("\n" + i); t.b("            <option value=\"13\" "); if (t.s(t.f("is-condition-thirteen", c, p, 1), c, p, 0, 2273, 2281, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">3</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 2371, 2379, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">2</option>"); t.b("\n" + i); t.b("            <option value=\"9\" "); if (t.s(t.f("is-condition-nine", c, p, 1), c, p, 0, 2464, 2472, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">1</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-comic", c, p, 1), c, p, 0, 2548, 4054, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 2600, 2608, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("            <option value=\"8\" "); if (t.s(t.f("is-condition-eight", c, p, 1), c, p, 0, 2701, 2709, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">10.0</option>"); t.b("\n" + i); t.b("            <option value=\"18\" "); if (t.s(t.f("is-condition-eighteen", c, p, 1), c, p, 0, 2804, 2812, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.9</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 2905, 2913, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.8</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 3002, 3010, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.6</option>"); t.b("\n" + i); t.b("            <option value=\"17\" "); if (t.s(t.f("is-condition-seventeen", c, p, 1), c, p, 0, 3103, 3111, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.4</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 3203, 3211, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.2</option>"); t.b("\n" + i); t.b("            <option value=\"16\" "); if (t.s(t.f("is-condition-sixteen", c, p, 1), c, p, 0, 3302, 3310, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">9.0</option>"); t.b("\n" + i); t.b("            <option value=\"5\" "); if (t.s(t.f("is-condition-five", c, p, 1), c, p, 0, 3401, 3409, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">8.0</option>"); t.b("\n" + i); t.b("            <option value=\"15\" "); if (t.s(t.f("is-condition-fifteen", c, p, 1), c, p, 0, 3501, 3509, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">7.0</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 3599, 3607, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">6.0</option>"); t.b("\n" + i); t.b("            <option value=\"14\" "); if (t.s(t.f("is-condition-fourteen", c, p, 1), c, p, 0, 3699, 3707, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">5.0</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 3800, 3808, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">4.0</option>"); t.b("\n" + i); t.b("            <option value=\"13\" "); if (t.s(t.f("is-condition-thirteen", c, p, 1), c, p, 0, 3902, 3910, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">3.0</option>"); t.b("\n" + i); t.b("            <option value=\"9\" "); if (t.s(t.f("is-condition-nine", c, p, 1), c, p, 0, 4002, 4010, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">2.0</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-proof-coin", c, p, 1), c, p, 0, 4094, 5203, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 4146, 4154, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("            <option value=\"13\" "); if (t.s(t.f("is-condition-thirteen", c, p, 1), c, p, 0, 4251, 4259, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR61</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 4353, 4361, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR62</option>"); t.b("\n" + i); t.b("            <option value=\"14\" "); if (t.s(t.f("is-condition-fourteen", c, p, 1), c, p, 0, 4456, 4464, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR63</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 4556, 4564, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR64</option>"); t.b("\n" + i); t.b("            <option value=\"15\" "); if (t.s(t.f("is-condition-fifteen", c, p, 1), c, p, 0, 4656, 4664, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR65</option>"); t.b("\n" + i); t.b("            <option value=\"5\" "); if (t.s(t.f("is-condition-five", c, p, 1), c, p, 0, 4756, 4764, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR66</option>"); t.b("\n" + i); t.b("            <option value=\"16\" "); if (t.s(t.f("is-condition-sixteen", c, p, 1), c, p, 0, 4857, 4865, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR67</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 4956, 4964, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR68</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 5052, 5060, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR69</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 5149, 5157, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">PR70</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-coin", c, p, 1), c, p, 0, 5242, 6997, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 5294, 5302, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Ungraded</option>"); t.b("\n" + i); t.b("            <option value=\"17\" "); if (t.s(t.f("is-condition-seventeen", c, p, 1), c, p, 0, 5400, 5408, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">VG (8-10)</option>"); t.b("\n" + i); t.b("            <option value=\"8\" "); if (t.s(t.f("is-condition-eight", c, p, 1), c, p, 0, 5508, 5516, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">F (12-15)</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 5612, 5620, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">VF (20-35)</option>"); t.b("\n" + i); t.b("            <option value=\"9\" "); if (t.s(t.f("is-condition-nine", c, p, 1), c, p, 0, 5716, 5724, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">XF (40-45)</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 5818, 5826, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">AU (50-58)</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 5920, 5928, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS60</option>"); t.b("\n" + i); t.b("            <option value=\"13\" "); if (t.s(t.f("is-condition-thirteen", c, p, 1), c, p, 0, 6021, 6029, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS61</option>"); t.b("\n" + i); t.b("            <option value=\"5\" "); if (t.s(t.f("is-condition-five", c, p, 1), c, p, 0, 6122, 6130, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS62</option>"); t.b("\n" + i); t.b("            <option value=\"14\" "); if (t.s(t.f("is-condition-fourteen", c, p, 1), c, p, 0, 6224, 6232, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS63</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 6324, 6332, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS64</option>"); t.b("\n" + i); t.b("            <option value=\"15\" "); if (t.s(t.f("is-condition-fifteen", c, p, 1), c, p, 0, 6424, 6432, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS65</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 6525, 6533, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS66</option>"); t.b("\n" + i); t.b("            <option value=\"16\" "); if (t.s(t.f("is-condition-sixteen", c, p, 1), c, p, 0, 6627, 6635, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS67</option>"); t.b("\n" + i); t.b("            <option value=\"18\" "); if (t.s(t.f("is-condition-eighteen", c, p, 1), c, p, 0, 6732, 6740, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS68</option>"); t.b("\n" + i); t.b("            <option value=\"19\" "); if (t.s(t.f("is-condition-nineteen", c, p, 1), c, p, 0, 6838, 6846, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS69</option>"); t.b("\n" + i); t.b("            <option value=\"20\" "); if (t.s(t.f("is-condition-twenty", c, p, 1), c, p, 0, 6942, 6950, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">MS70</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-lego-set", c, p, 1), c, p, 0, 7034, 7867, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 7086, 7094, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Pieces only</option>"); t.b("\n" + i); t.b("            <option value=\"9\" "); if (t.s(t.f("is-condition-nine", c, p, 1), c, p, 0, 7189, 7197, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Pieces and Manual</option>"); t.b("\n" + i); t.b("            <option value=\"8\" "); if (t.s(t.f("is-condition-eight", c, p, 1), c, p, 0, 7300, 7308, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Pieces and Box</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 7409, 7417, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">CIB</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 7505, 7513, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">New</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 7599, 7607, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Box only</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 7700, 7708, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Manual only</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 7805, 7813, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Box and Manual</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-funko-pop", c, p, 1), c, p, 0, 7909, 8213, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 7961, 7969, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Loose</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 8059, 8067, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">In Dmg Box</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 8162, 8170, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">New</option>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-video-game", c, p, 1), c, p, 0, 8257, 9299, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <option value=\"1\" "); if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 8309, 8317, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Item only</option>"); t.b("\n" + i); t.b("            <option value=\"3\" "); if (t.s(t.f("is-condition-three", c, p, 1), c, p, 0, 8411, 8419, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">CIB</option>"); t.b("\n" + i); t.b("            <option value=\"2\" "); if (t.s(t.f("is-condition-two", c, p, 1), c, p, 0, 8507, 8515, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">New</option>"); t.b("\n" + i); t.b("            <option value=\"5\" "); if (t.s(t.f("is-condition-five", c, p, 1), c, p, 0, 8602, 8610, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Graded New</option>"); t.b("\n" + i); t.b("            <option value=\"13\" "); if (t.s(t.f("is-condition-thirteen", c, p, 1), c, p, 0, 8710, 8718, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Graded CIB</option>"); t.b("\n" + i); t.b("            <option value=\"6\" "); if (t.s(t.f("is-condition-six", c, p, 1), c, p, 0, 8816, 8824, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Box only</option>"); t.b("\n" + i); t.b("            <option value=\"7\" "); if (t.s(t.f("is-condition-seven", c, p, 1), c, p, 0, 8917, 8925, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Manual only</option>"); t.b("\n" + i); t.b("            <option value=\"8\" "); if (t.s(t.f("is-condition-eight", c, p, 1), c, p, 0, 9023, 9031, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Item and Box</option>"); t.b("\n" + i); t.b("            <option value=\"9\" "); if (t.s(t.f("is-condition-nine", c, p, 1), c, p, 0, 9129, 9137, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Item and Manual</option>"); t.b("\n" + i); t.b("            <option value=\"10\" "); if (t.s(t.f("is-condition-ten", c, p, 1), c, p, 0, 9237, 9245, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("selected"); });
                c.pop();
            } t.b(">Box and Manual</option>"); t.b("\n" + i); });
            c.pop();
        } t.b("        </select>"); t.b("\n" + i); t.b("        <input"); t.b("\n" + i); t.b("            type=\"number\""); t.b("\n" + i); t.b("            min=\"1\""); t.b("\n" + i); t.b("            step=\"1\""); t.b("\n" + i); t.b("            id=\"js-quantity\""); t.b("\n" + i); t.b("            value=\""); t.b(t.v(t.f("quantity", c, p, 0))); t.b("\""); t.b("\n" + i); t.b("            title=\"Enter quantity you own in exact same condition\""); t.b("\n" + i); t.b("            class=\"quantity\""); t.b("\n" + i); t.b("        />"); t.b("\n" + i); if (t.s(t.f("has-folders", c, p, 1), c, p, 0, 9611, 9929, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("            <select name=\"folder\" id=\"js-folder\">"); t.b("\n" + i); t.b("                <option value=\"\"></option>"); t.b("\n" + i); if (t.s(t.f("folders", c, p, 1), c, p, 0, 9733, 9820, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("                <option value=\""); t.b(t.v(t.f("Id", c, p, 0))); t.b("\" "); t.b(t.v(t.f("Selected", c, p, 0))); t.b(">"); t.b(t.v(t.f("Name", c, p, 0))); t.b("</option>"); t.b("\n" + i); });
                c.pop();
            } t.b("                <option value=\"-new-folder\">-New Folder-</option>"); t.b("\n" + i); t.b("            </select>"); t.b("\n" + i); });
            c.pop();
        } });
        c.pop();
    } if (!t.s(t.f("user-viewing-own-offers", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("        ");
        t.b(t.v(t.f("include-string", c, p, 0)));
        t.b("<br>");
        t.b("\n" + i);
        t.b("        Qty: ");
        t.b(t.v(t.f("quantity", c, p, 0)));
        t.b("\n" + i);
    } ; t.b("    </td>"); t.b("\n" + i); if (t.s(t.f("user-viewing-own-offers", c, p, 1), c, p, 0, 10144, 10376, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("    <td class=\"cost tablet-portrait-hidden\">"); t.b("\n" + i); t.b("        <input"); t.b("\n" + i); t.b("            type=\"number\""); t.b("\n" + i); t.b("            step=\"0.01\""); t.b("\n" + i); t.b("            id=\"js-cost\""); t.b("\n" + i); t.b("            class=\"js-price\""); t.b("\n" + i); t.b("            value=\""); t.b(t.v(t.f("cost-basis-string", c, p, 0))); t.b("\""); t.b("\n" + i); t.b("        />"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); });
        c.pop();
    } t.b("	<td class=\"price\">"); t.b("\n" + i); if (t.s(t.f("is-grade-profit-sort", c, p, 1), c, p, 0, 10458, 11251, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { if (t.s(t.f("is-comic", c, p, 1), c, p, 0, 10484, 10708, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                <span class=\"atGrade\">@ 9.8: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-ten-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                <span class=\"atGrade\">@ 9.2: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-nine-profit", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-coin", c, p, 1), c, p, 0, 10746, 10972, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                <span class=\"atGrade\">@ MS66: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-ten-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                <span class=\"atGrade\">@ MS64: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-nine-profit", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
            c.pop();
        } if (t.s(t.f("is-card", c, p, 1), c, p, 0, 11009, 11230, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                <span class=\"atGrade\">@ 10: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-ten-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                <span class=\"atGrade\">@ 9: </span><span class=\"js-price\">"); t.b(t.v(t.f("grade-nine-profit", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
            c.pop();
        } });
        c.pop();
    } if (!t.s(t.f("is-grade-profit-sort", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("            <a href=\"/game/");
        t.b(t.v(t.f("id", c, p, 0)));
        t.b("\" title=\"see historic prices\" >");
        t.b("\n" + i);
        t.b("                <span class=\"js-price\">");
        t.b(t.v(t.f("max-price-string", c, p, 0)));
        t.b("</span>");
        t.b("\n" + i);
        t.b("            </a>");
        t.b("\n" + i);
    } ; t.b("\n" + i); if (!t.s(t.f("is-grade-profit-sort", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("            <div class=\"change-icons\">");
        t.b("\n" + i);
        t.b("                ");
        if (t.s(t.f("show-arrow-down", c, p, 1), c, p, 0, 11604, 11643, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("<span class=\"arrow down\">&#9662;</span>"); });
            c.pop();
        }
        t.b("\n" + i);
        t.b("                ");
        if (t.s(t.f("show-arrow-up", c, p, 1), c, p, 0, 11698, 11735, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("<span class=\"arrow up\">&#9652;</span>"); });
            c.pop();
        }
        t.b("\n");
        t.b("\n" + i);
        t.b("                <div class=\"tour\">");
        t.b("\n" + i);
        t.b("                    <div class=\"pointer-up\"></div>");
        t.b("\n" + i);
        t.b("                    Price Change: ");
        t.b(t.v(t.f("price-change-sign", c, p, 0)));
        t.b(t.v(t.f("price-change-string", c, p, 0)));
        t.b("<br>");
        t.b("\n" + i);
        t.b("                    <a class=\"done\" href=\"#\">OK</a>");
        t.b("\n" + i);
        t.b("                </div>");
        t.b("\n" + i);
        t.b("            </div>");
        t.b("\n" + i);
    } ; if (t.s(t.f("support-grading-recommendations", c, p, 1), c, p, 0, 12096, 15777, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { if (t.s(t.f("is-pro", c, p, 1), c, p, 0, 12120, 15757, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { if (!t.s(t.f("is-grade-profit-sort", c, p, 1), c, p, 1, 0, 0, "")) {
                if (t.s(t.f("needs-stars", c, p, 1), c, p, 0, 12199, 14122, "{{ }}")) {
                    t.rs(c, p, function (c, p, t) { t.b("                        <div class=\"stars\" title=\"click for grading recommendations\">"); t.b("\n" + i); t.b("                            <span>"); t.b("\n" + i); t.b("                                "); if (t.s(t.f("show-star-one", c, p, 1), c, p, 0, 12371, 12401, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("<img src=\"/images/star.png\" />"); });
                        c.pop();
                    } t.b("\n" + i); t.b("                                "); if (t.s(t.f("show-star-two", c, p, 1), c, p, 0, 12470, 12500, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("<img src=\"/images/star.png\" />"); });
                        c.pop();
                    } t.b("\n" + i); t.b("                                "); if (t.s(t.f("show-star-three", c, p, 1), c, p, 0, 12571, 12601, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("<img src=\"/images/star.png\" />"); });
                        c.pop();
                    } t.b("\n" + i); t.b("                                "); if (t.s(t.f("show-star-four", c, p, 1), c, p, 0, 12673, 12703, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("<img src=\"/images/star.png\" />"); });
                        c.pop();
                    } t.b("\n" + i); t.b("                                "); if (t.s(t.f("show-star-five", c, p, 1), c, p, 0, 12774, 12804, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("<img src=\"/images/star.png\" />"); });
                        c.pop();
                    } t.b("\n" + i); t.b("                            </span>"); t.b("\n"); t.b("\n" + i); t.b("                            <div class=\"tour\">"); t.b("\n" + i); t.b("                                <div class=\"pointer-up\"></div>"); t.b("\n" + i); t.b("                                <a href=\"/page/grading-recommendations\" target=\"_blank\" class=\"grade-recs-head\">"); t.b("\n" + i); t.b("                                    Grading Recommendations"); t.b("\n" + i); t.b("                                </a>"); t.b("\n"); t.b("\n" + i); t.b("                                Profit @ Grade 10: <span class=\"js-price\">"); t.b(t.v(t.f("grade-ten-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                                Profit @ Grade 9: <span class=\"js-price\">"); t.b(t.v(t.f("grade-nine-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                                Profit @ Grade 8: <span class=\"js-price\">"); t.b(t.v(t.f("grade-eight-profit", c, p, 0))); t.b("</span><br>"); t.b("\n"); t.b("\n" + i); t.b("                                <a href=\"https://psacard-web.app.link/e/qr7AREwIhRb?$3p=a_hasoffers&$affiliate_json=https%3A%2F%2Fpsacard.go2cloud.org%2Faff_c%3Foffer_id%3D19%26aff_id%3D21%26source%3Dgrading-recs-sub%26format%3Djson\" target=\"_blank\" class=\"medium blue button grade-with\">"); t.b("\n" + i); t.b("                                    Grade with PSA"); t.b("\n" + i); t.b("                                </a>"); t.b("\n" + i); t.b("                                <span class=\"grade-with-msg\">$25 off with code: PC25</span>"); t.b("\n"); t.b("\n" + i); t.b("                                <a class=\"done\" href=\"#\">OK</a>"); t.b("\n" + i); t.b("                            </div>"); t.b("\n" + i); t.b("                        </div>"); t.b("\n" + i); });
                    c.pop();
                }
                if (!t.s(t.f("needs-stars", c, p, 1), c, p, 1, 0, 0, "")) {
                    if (t.s(t.f("is-condition-one", c, p, 1), c, p, 0, 14221, 15644, "{{ }}")) {
                        t.rs(c, p, function (c, p, t) { t.b("                        <div class=\"stars\" title=\"click for grading recommendations\">"); t.b("\n" + i); t.b("                            <span style=\"color: #ccc;\">&#9679;</span>"); t.b("\n"); t.b("\n" + i); t.b("                            <div class=\"tour\">"); t.b("\n" + i); t.b("                                <div class=\"pointer-up\"></div>"); t.b("\n" + i); t.b("                                <a href=\"/page/grading-recommendations\" target=\"_blank\" class=\"grade-recs-head\">"); t.b("\n" + i); t.b("                                    Grading Recommendations"); t.b("\n" + i); t.b("                                </a>"); t.b("\n"); t.b("\n" + i); t.b("                                Profit @ Grade 10: <span class=\"js-price\">"); t.b(t.v(t.f("grade-ten-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                                Profit @ Grade 9: <span class=\"js-price\">"); t.b(t.v(t.f("grade-nine-profit", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("                                Profit @ Grade 8: <span class=\"js-price\">"); t.b(t.v(t.f("grade-eight-profit", c, p, 0))); t.b("</span><br>"); t.b("\n"); t.b("\n" + i); t.b("                                <a href=\"https://psacard-web.app.link/e/qr7AREwIhRb?$3p=a_hasoffers&$affiliate_json=https%3A%2F%2Fpsacard.go2cloud.org%2Faff_c%3Foffer_id%3D19%26aff_id%3D21%26source%3Dgrading-recs-sub%26format%3Djson\" target=\"_blank\" class=\"medium blue button grade-with\">"); t.b("\n" + i); t.b("                                    Grade with PSA"); t.b("\n" + i); t.b("                                </a>"); t.b("\n" + i); t.b("                                <span class=\"grade-with-msg\">$25 off with code: PC25</span>"); t.b("\n"); t.b("\n" + i); t.b("                                <a class=\"done\" href=\"#\">OK</a>"); t.b("\n" + i); t.b("                            </div>"); t.b("\n" + i); t.b("                        </div>"); t.b("\n" + i); });
                        c.pop();
                    }
                }
                ;
            } ; });
            c.pop();
        } });
        c.pop();
    } t.b("	</td>"); t.b("\n" + i); if (t.s(t.f("user-viewing-own-offers", c, p, 1), c, p, 0, 15850, 16193, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("	<td class=\"links\">"); t.b("\n" + i); t.b("		<ul>"); t.b("\n" + i); t.b("			<li>"); t.b("\n" + i); t.b("				<a href=\"/publish-offer?offer="); t.b(t.v(t.f("offer-id", c, p, 0))); t.b("&add-to-collection=1\" target=\"_blank\">"); t.b("\n" + i); t.b("					Edit</a>"); t.b("\n" + i); t.b("			</li>"); t.b("\n" + i); t.b("            <li>"); t.b("\n" + i); t.b("                <a href=\"#\""); t.b("\n" + i); t.b("                    class=\"js-remove-offer\""); t.b("\n" + i); t.b("                    title=\"Remove item from your collection\">Remove</a>"); t.b("\n" + i); t.b("            </li>"); t.b("\n" + i); t.b("		</ul>"); t.b("\n" + i); t.b("	</td>"); t.b("\n"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("user-viewing-own-offers", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("	<td class=\"links\">");
        t.b("\n" + i);
        t.b("	</td>");
        t.b("\n" + i);
    } ; t.b("</tr>"); t.b("\n"); t.b("\n" + i); t.b("<tr class=\"gap\" id=\"gap-"); t.b(t.v(t.f("offer-id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("    <td colspan=\"3\"></td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["offers-item"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr class=\"offer\">"); t.b("\n" + i); t.b("    <td class=\"photo\">"); t.b("\n" + i); t.b("        <div>"); t.b("\n" + i); t.b("            <a class=\"image-wrapper\" href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                <img src=\""); t.b(t.v(t.f("image-url", c, p, 0))); t.b("\" loading=lazy>"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("        <div class=\"gallery_details\">"); t.b("\n" + i); t.b("            <p><a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b(t.v(t.f("product-name", c, p, 0))); t.b("</a></p>"); t.b("\n" + i); t.b("            <p name=\"console-name\">"); t.b(t.v(t.f("console-name", c, p, 0))); t.b("</p>"); t.b("\n" + i); t.b("            <p>"); t.b("\n" + i); t.b("                <span name=\"includes-string\">"); t.b(t.v(t.f("include-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("                <span name=\"price\" class=\"price js-price\">"); t.b(t.v(t.f("price-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("            </p>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"meta\">"); t.b("\n" + i); t.b("        <h2 class=\"product_name\">"); t.b("\n" + i); if (t.s(t.f("is-single-product", c, p, 1), c, p, 0, 661, 756, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b(t.v(t.f("include-string", c, p, 0))); t.b(" | "); t.b(t.v(t.f("condition-string", c, p, 0))); t.b("</a>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("is-single-product", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("            <a href=\"");
        t.b(t.v(t.f("offer-url", c, p, 0)));
        t.b("\">");
        t.b(t.v(t.f("product-name", c, p, 0)));
        t.b("</a><br>");
        t.b("\n" + i);
        t.b("            ");
        t.b(t.v(t.f("console-name", c, p, 0)));
        t.b("\n" + i);
    } ; t.b("        </h2>"); t.b("\n" + i); t.b("        <p class=\"includes\">"); t.b("\n" + i); t.b("            <span>Includes: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("include-string", c, p, 0))); t.b("<br>"); t.b("\n" + i); t.b("            <span>Condition: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("condition-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); if (t.s(t.f("is-sold", c, p, 1), c, p, 0, 1175, 1315, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <p class=\"sold_date\">"); t.b("\n" + i); t.b("            <span>Sold: </span>"); t.b("\n" + i); t.b("            <span name=\"sale-time\">"); t.b(t.v(t.f("sale-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); });
        c.pop();
    } t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"pricebox\">"); t.b("\n" + i); t.b("        <p class=\"listing_type\">"); t.b("\n" + i); if (t.s(t.f("is-price-descending", c, p, 1), c, p, 0, 1433, 1466, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            Auction"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("is-price-descending", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("            &nbsp;");
        t.b("\n" + i);
    } ; t.b("        </p>"); t.b("\n" + i); t.b("        <p class=\"price\">"); t.b("\n" + i); t.b("            <span name=\"price js-price\">"); t.b(t.v(t.f("price-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("            <br><span class=\"text\">+ free shipping</span>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("        <p>"); t.b("\n" + i); t.b("            <a class=\"orange button large\" name=\"details\" href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                Details"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("</tr>"); t.b("\n"); t.b("\n" + i); t.b("<tr class=\"gap\">"); t.b("\n" + i); t.b("    <td colspan=\"3\"></td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["offers-seller-item"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr class=\"offer offer-item\">"); t.b("\n" + i); t.b("    <td class=\"photo\">"); t.b("\n" + i); t.b("        <div>"); t.b("\n" + i); t.b("            <a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("                <img src=\""); t.b(t.v(t.f("image-url", c, p, 0))); t.b("\" loading=lazy>"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"meta\">"); t.b("\n" + i); if (t.s(t.f("is-sold", c, p, 1), c, p, 0, 243, 833, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("            <p class=\"order_date\">"); t.b("\n" + i); t.b("                <span>Sold: </span><span name=\"sale-time\">"); t.b(t.v(t.f("sale-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); if (t.s(t.f("is-refunded", c, p, 1), c, p, 0, 390, 527, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                    <br>"); t.b("\n" + i); t.b("                    <span>Refunded: </span><span name=\"refunded-time\">"); t.b(t.v(t.f("refunded-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
            c.pop();
        } if (!t.s(t.f("is-refunded", c, p, 1), c, p, 1, 0, 0, "")) {
            if (t.s(t.f("is-shipped", c, p, 1), c, p, 0, 612, 759, "{{ }}")) {
                t.rs(c, p, function (c, p, t) { t.b("                        <br/>"); t.b("\n" + i); t.b("                        <span>Shipped: </span><span name=\"shipped-time\">"); t.b(t.v(t.f("shipped-time", c, p, 0))); t.b("</span>"); t.b("\n" + i); });
                c.pop();
            }
        } ; t.b("            </p>"); t.b("\n" + i); });
        c.pop();
    } t.b("        <p class=\"title\">"); t.b("\n" + i); if (t.s(t.f("is-pending-payment-account", c, p, 1), c, p, 0, 915, 989, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("                <span style=\"color: red;\">Pending</span><br>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("is-pending-payment-account", c, p, 1), c, p, 1, 0, 0, "")) {
        if (t.s(t.f("is-pending-vacation", c, p, 1), c, p, 0, 1105, 1193, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("                    <span style=\"color: red;\">Vacation Hold</span><br>"); t.b("\n" + i); });
            c.pop();
        }
    } ; t.b("            <a href=\""); t.b(t.v(t.f("offer-url", c, p, 0))); t.b("\">"); t.b(t.v(t.f("product-name", c, p, 0))); t.b("</a><br>"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("console-name", c, p, 0))); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("        <p class=\"includes\">"); t.b("\n" + i); t.b("            <span>Includes: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("include-string", c, p, 0))); t.b("</span><br>"); t.b("\n" + i); t.b("            <span>Condition: </span>"); t.b("\n" + i); t.b("            <span>"); t.b(t.v(t.f("condition-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("        </p>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); if (t.s(t.f("is-available", c, p, 1), c, p, 0, 1605, 1915, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <td class=\"lowest\">"); t.b("\n" + i); if (t.s(t.f("is-best-priced-offer", c, p, 1), c, p, 0, 1671, 1747, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { t.b("               <span class=\"check_mark\">&#x2713; lowest</span>"); t.b("\n" + i); });
            c.pop();
        } if (!t.s(t.f("is-best-priced-offer", c, p, 1), c, p, 1, 0, 0, "")) {
            t.b("                ");
            t.b(t.v(t.f("best-competing-price-string", c, p, 0)));
            t.b("\n" + i);
        } ; t.b("        </td>"); t.b("\n" + i); });
        c.pop();
    } t.b("    <td class=\"price\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price-string", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"links\">"); t.b("\n" + i); t.b("        <ul>"); t.b("\n" + i); if (t.s(t.f("is-ended", c, p, 1), c, p, 0, 2082, 2840, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { if (t.s(t.f("is-sold", c, p, 1), c, p, 0, 2111, 2695, "{{ }}")) {
            t.rs(c, p, function (c, p, t) { if (!t.s(t.f("is-refunded", c, p, 1), c, p, 1, 0, 0, "")) {
                if (!t.s(t.f("is-shipped", c, p, 1), c, p, 1, 0, 0, "")) {
                    t.b("                            <li>");
                    t.b("\n" + i);
                    t.b("                                <a href=\"");
                    t.b(t.v(t.f("offer-url", c, p, 0)));
                    t.b("#tracking-form\">Mark as shipped</a>");
                    t.b("\n" + i);
                    t.b("                            </li>");
                    t.b("\n" + i);
                }
                ;
                if (!t.s(t.f("seller-left-feedback", c, p, 1), c, p, 1, 0, 0, "")) {
                    t.b("                            <li>");
                    t.b("\n" + i);
                    t.b("                                <a href=\"");
                    t.b(t.v(t.f("offer-url", c, p, 0)));
                    t.b("#feedback-form\">Leave feedback</a>");
                    t.b("\n" + i);
                    t.b("                            </li>");
                    t.b("\n" + i);
                }
                ;
            } ; });
            c.pop();
        } t.b("                <li>"); t.b("\n" + i); t.b("                    <a href=\"/publish-offer?product="); t.b(t.v(t.f("id", c, p, 0))); t.b("\">Sell similar</a>"); t.b("\n" + i); t.b("                </li>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("is-ended", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("                <li>");
        t.b("\n" + i);
        t.b("                    <a href=\"/publish-offer?offer=");
        t.b(t.v(t.f("offer-id", c, p, 0)));
        t.b("\" target=\"_blank\">Edit Details</a>");
        t.b("\n" + i);
        t.b("                </li>");
        t.b("\n" + i);
        t.b("                <li>");
        t.b("\n" + i);
        t.b("                    <a href=\"/end-offer/");
        t.b(t.v(t.f("offer-id", c, p, 0)));
        t.b("\">Close</a>");
        t.b("\n" + i);
        t.b("                </li>");
        t.b("\n" + i);
    } ; t.b("        </ul>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("</tr>"); t.b("\n"); t.b("\n" + i); t.b("<tr class=\"gap\">"); t.b("\n" + i); t.b("    <td colspan=\"3\"></td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["snipe"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr class=\"snipe-deal js-snipe-deal "); t.b(t.v(t.f("listing_type_name", c, p, 0))); if (t.s(t.f("is_sample", c, p, 1), c, p, 0, 71, 99, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b(" js-snipe-deal-sample sample"); });
        c.pop();
    } t.b("\">"); t.b("\n" + i); t.b("    <td class=\"photo phone-portrait-hidden\" title=\"click to see listing\">"); t.b("\n" + i); t.b("        <div class=\"primary\">"); t.b("\n" + i); t.b("            <a target=\"_blank\" href=\""); t.b(t.v(t.f("affiliate_link", c, p, 0))); t.b("\" onClick=\"analytics_track_event('Ads', 'eBay', 'BIN_Snipe', 74)\">"); t.b("\n" + i); t.b("                <img src=\""); t.b(t.v(t.f("picture_url", c, p, 0))); t.b("\" />"); t.b("\n" + i); t.b("            </a>"); t.b("\n" + i); t.b("        </div>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"product-name\">"); t.b("\n" + i); t.b("        <a target=\"_blank\" href=\"/game/"); t.b(t.v(t.f("product_id", c, p, 0))); t.b("#completed-auctions-"); t.b(t.v(t.f("condition_name", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("product_name", c, p, 0))); t.b(" ("); t.b(t.v(t.f("console_name", c, p, 0))); t.b(")"); t.b("\n" + i); t.b("        </a>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"title\" title=\""); t.b(t.v(t.f("title", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("        <a target=\"_blank\" href=\""); t.b(t.v(t.f("affiliate_link", c, p, 0))); t.b("\" onClick=\"analytics_track_event('Ads', 'eBay', 'BIN_Snipe', 74)\">"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("title", c, p, 0))); t.b("\n" + i); t.b("        </a>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"numeric estimate-savings\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("savings", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"numeric estimated-price\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("price", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("    <td class=\"numeric estimated-price\" title=\""); t.b(t.v(t.f("condition_name", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("        <span class=\"js-price\">"); t.b(t.v(t.f("estimated", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("    </td>"); t.b("\n" + i); t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
templates["wishlist-item"] = new Hogan.Template({ code: function (c, p, i) { var t = this; t.b(i = i || ""); t.b("<tr id=\"bid-"); t.b(t.v(t.f("id", c, p, 0))); t.b("\" data-product=\""); t.b(t.v(t.f("product-id", c, p, 0))); t.b("\" >"); t.b("\n" + i); t.b("	<td class=\"photo\">"); t.b("\n" + i); t.b("		<div>"); t.b("\n" + i); t.b("			<a href=\"/game/"); t.b(t.v(t.f("product-id", c, p, 0))); t.b("\">"); t.b("\n" + i); t.b("				<img src=\""); t.b(t.v(t.f("image-url", c, p, 0))); t.b("\" loading=lazy>"); t.b("\n" + i); t.b("			</a>"); t.b("\n" + i); t.b("		</div>"); t.b("\n" + i); t.b("	</td>"); t.b("\n" + i); t.b("	<td class=\"meta\">"); t.b("\n" + i); t.b("		<p class=\"title\">"); t.b("\n" + i); t.b("			<a href=\"/game/"); t.b(t.v(t.f("product-id", c, p, 0))); t.b("\">"); t.b(t.v(t.f("product-name", c, p, 0))); t.b("</a><br>"); t.b("\n" + i); t.b("            "); t.b(t.v(t.f("console-name", c, p, 0))); t.b("\n" + i); t.b("		</p>"); t.b("\n" + i); t.b("	</td>"); t.b("\n" + i); t.b("	<td class=\"price\">"); t.b("\n" + i); t.b("		<a href=\"/game/"); t.b(t.v(t.f("product-id", c, p, 0))); t.b("\" title=\"see historic prices\" >"); t.b("\n" + i); t.b("			<span class=\"js-price\">"); t.b(t.v(t.f("price", c, p, 0))); t.b("</span>"); t.b("\n" + i); t.b("		</a>"); t.b("\n" + i); t.b("	</td>"); t.b("\n" + i); if (t.s(t.f("user-viewing-own-wishlist", c, p, 1), c, p, 0, 494, 659, "{{ }}")) {
        t.rs(c, p, function (c, p, t) { t.b("        <td class=\"cancel\">"); t.b("\n" + i); t.b("            <input type=button value=\"-\" class=\"small blue button js-cancel-bid\" title=\"Remove item from wishlist\" />"); t.b("\n" + i); t.b("        </td>"); t.b("\n" + i); });
        c.pop();
    } if (!t.s(t.f("user-viewing-own-wishlist", c, p, 1), c, p, 1, 0, 0, "")) {
        t.b("	<td class=\"links\">");
        t.b("\n" + i);
        t.b("	</td>");
        t.b("\n" + i);
    } ; t.b("</tr>"); return t.fl(); }, partials: {}, subs: {} });
var ZBarConnector;
var dialogSizeRatio = 0.8;
function implement_upc_scanner() {
    $("#scan_button").click(function () {
        analytics_track_event("Tools", "UPC Scanner", "Clicked");
        show_scanner_dialog();
        ZBarConnector.start(onSuccess);
    });
}
function onSuccess(symbols) {
    if (symbols.length > 0) {
        handle_detection(symbols[0].decode());
        return true;
    }
    return false;
}
function handle_detection(code) {
    $("#js-dialog-upc").dialog("close");
    submit_upc(code);
}
function submit_upc(code) {
    var input = $("#game_search_box");
    if (input.length === 0) {
        return;
    }
    input.val(code);
    var inputElement = input.get(0);
    analytics_track_event("Tools", "UPC Scanner", "Submitted Scan");
    inputElement.form.submit();
}
function show_scanner_dialog() {
    $("#js-dialog-upc").dialog({
        position: { my: "top", at: "top", of: "body" },
        modal: true,
        title: "Scan UPC Code",
        draggable: false,
        dialogClass: "upc-dialog",
        width: window.innerWidth * dialogSizeRatio,
        height: window.innerHeight * dialogSizeRatio,
        close: ZBarConnector.clear,
    });
}
var pageViewStatsKey = "_PageViewStats";
var persistKeyData;
var getKeyData;
var removeKeyData;
if ((typeof (window) !== 'undefined') && window.localStorage) {
    var localStorage = window.localStorage;
    persistKeyData = function (key, data) {
        var stringData = JSON.stringify(data);
        localStorage.setItem(key, stringData);
    };
    getKeyData = function (key) {
        var data = localStorage.getItem(key);
        if (data) {
            return JSON.parse(data);
        }
        return null;
    };
    removeKeyData = function (key) {
        localStorage.removeItem(key);
    };
}
else {
    var mockedData = {};
    persistKeyData = function (key, data) {
        var stringData = JSON.stringify(data);
        mockedData[key] = stringData;
    };
    getKeyData = function (key) {
        var data = mockedData[key];
        if (data) {
            return JSON.parse(data);
        }
        return null;
    };
    removeKeyData = function (key) {
        delete mockedData[key];
    };
}
function createEmptyData() {
    var pageViewStats = {
        countByConsole: {}
    };
    persistKeyData(pageViewStatsKey, pageViewStats);
    var result = {
        pageViewStats: pageViewStats
    };
    return result;
}
var LocalData;
(function (LocalData) {
    function getPageViewStats() {
        var data = getKeyData(pageViewStatsKey);
        if (!data) {
            data = createEmptyData().pageViewStats;
        }
        return data;
    }
    LocalData.getPageViewStats = getPageViewStats;
    function clearPageViewStats() {
        removeKeyData(pageViewStatsKey);
    }
    LocalData.clearPageViewStats = clearPageViewStats;
    function rankedConsoleForUser(i) {
        var byConsole = getPageViewStats().countByConsole;
        return (Object.keys(byConsole).map(function (k) {
            return {
                console_uid: k,
                count: byConsole[k]
            };
        }).sort(function (a, b) {
            return b.count - a.count;
        })[i] || { console_uid: null }).console_uid;
    }
    LocalData.rankedConsoleForUser = rankedConsoleForUser;
    function updatePageView(console_uid) {
        var stats = getPageViewStats();
        if (typeof (stats.countByConsole[console_uid]) === 'undefined') {
            stats.countByConsole[console_uid] = 0;
        }
        stats.countByConsole[console_uid] += 1;
        persistKeyData(pageViewStatsKey, stats);
    }
    LocalData.updatePageView = updatePageView;
    function getLocalData() {
        return {
            pageViewStats: getPageViewStats()
        };
    }
    LocalData.getLocalData = getLocalData;
})(LocalData || (LocalData = {}));
function has_keys(object) {
    for (var i in object) {
        if (object.hasOwnProperty(i)) {
            return true;
        }
    }
    return false;
}
function hashKeys(hash) {
    var k;
    var keys = [];
    for (k in hash) {
        if (hash.hasOwnProperty(k)) {
            keys.push(k);
        }
    }
    return keys;
}
function analytics_track_event(category, label, action, value) {
    gtag('event', category, {
        'label': label,
        'action': action,
        'value': value,
    });
}
function uri_name(name) {
    name = name.replace(new RegExp(',\\s', 'g'), ' ');
    name = name.replace(new RegExp('\\s+', 'g'), '-');
    name = name.replace(new RegExp('[.!?/:#]', 'g'), '');
    name = name.replace(new RegExp('-{2,}', 'g'), '-');
    return name.toLowerCase();
}
function toast(message) {
    var div = $('#toast');
    div.html(message);
    var win = $(window);
    var top = win.scrollTop() + win.height() / 2;
    var left = (win.width() - div.width()) / 2;
    div.css('top', top);
    div.css('left', left);
    div.show();
    var delay = message.length * 45;
    setTimeout(function () { div.fadeOut('slow'); }, delay);
}
function support_hovered(x) {
    x.hover(function () { $(this).addClass('hovered'); }, function () { $(this).removeClass('hovered'); });
}
function is_upc(text) {
    return !!text.match(/^[0-9]{12}$/);
}
function getCellValue(row, index) {
    var cellValue = $(row).children('td').eq(index).text().trim();
    if (cellValue === "") {
        return "0";
    }
    if (cellValue.charAt(0) === "$" || cellValue.charAt(0) === "€" || cellValue.charAt(0) === "£" || cellValue.charAt(0) === "A" || cellValue.charAt(0) === "C" || cellValue.charAt(0) === "M" || cellValue.charAt(0) === "R") {
        return cellValue.replace(/[^0-9\.]+/g, "");
    }
    return cellValue;
}
window['autoreplace_404_image'] = function (img) {
    img.onerror = null;
    img.src = "https://www.pricecharting.com/images/no-image-available.png";
};
var GamePage = (function () {
    function GamePage() {
    }
    return GamePage;
}());
var Lot = (function () {
    function Lot() {
    }
    return Lot;
}());
var Product = (function () {
    function Product() {
    }
    return Product;
}());
var PriceItList = (function () {
    function PriceItList() {
    }
    return PriceItList;
}());
var ItemPrices = (function () {
    function ItemPrices() {
    }
    return ItemPrices;
}());
var ConsoleList = (function () {
    function ConsoleList() {
    }
    return ConsoleList;
}());
var ChartData = (function () {
    function ChartData() {
    }
    return ChartData;
}());
var ChartLabels = (function () {
    function ChartLabels() {
    }
    return ChartLabels;
}());
var CurrencyExchangeRates = (function () {
    function CurrencyExchangeRates() {
    }
    return CurrencyExchangeRates;
}());
var VGPC;
function implement_zombie_game() {
    var x = 0;
    $(document).ready(function () {
        x = Math.floor((Math.random() * 13) + 1);
        var zombieType = "";
        var points = 1;
        if (x == 1) {
            zombieType = "giant boss";
            points = 10;
        }
        else if (x == 2 || x == 3) {
            zombieType = "alien";
            var points = 5;
        }
        else if (x >= 4 && x <= 6) {
            zombieType = "green";
            var points = 2;
        }
        else if (x >= 7 && x <= 9) {
            zombieType = "giant";
        }
        else if (x >= 10 && x <= 13) {
            zombieType = "skinny";
        }
        else {
            return;
        }
        if (zombieType != "") {
            $("#zombie").addClass(zombieType);
            analytics_track_event('ZombieGame', zombieType, 'Appeared');
            var direction = "left";
            if (x % 2 == 0) {
                direction = "right";
            }
            $("#zombie").addClass(direction);
        }
        var shotsToKill = 0;
        $("#zombie").click(function () {
            var killit = false;
            shotsToKill++;
            if ($(this).hasClass("boss")) {
                if (shotsToKill == 10) {
                    killit = true;
                }
            }
            else if ($(this).hasClass("alien")) {
                if (shotsToKill == 2) {
                    killit = true;
                }
            }
            else {
                killit = true;
            }
            if (killit) {
                $(this).hide("explode", { pieces: 24 }, 500);
                var left = $(this).position().left;
                var top = $(this).position().top;
                $(this).after("<div id='zombie_point'>+" + points + "</div>");
                $("#zombie_point").css({ "top": top + 20, "left": left });
                $("#zombie_point").show();
                if (localStorage.killCount) {
                    localStorage.killCount = Number(localStorage.killCount) + points;
                }
                else {
                    localStorage.killCount = points;
                }
                implement_zombie_score();
                analytics_track_event('ZombieGame', zombieType, 'Kill');
                setTimeout(function () { $("#zombie_point").hide(); }, 800);
            }
        });
    });
}
function implement_zombie_score() {
    var kills = localStorage.killCount;
    if (kills) {
        var x = $("#zombie_kills");
        x.text("Score: " + kills);
        $("#killBadge").remove();
        if (kills < 5) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-gray.png" />');
        }
        else if (kills < 10) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-blue.png" />');
        }
        else if (kills < 50) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-green.png" />');
        }
        else if (kills < 100) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-purple.png" />');
        }
        else if (kills < 500) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-red.png" />');
        }
        else if (kills >= 1000) {
            x.prepend('<img id="killBadge" src="/images/zombies/crosshair-gold.png" />');
        }
    }
}
