const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

export const closedTabs = [
  { id: "s1", title: "iphone 13 pro 256gb | eBay sold listings", url: "https://www.ebay.com/sch/i.html?_nkw=iphone+13+pro+256gb&LH_Sold=1", lastModified: minutesAgo(4) },
  { id: "s2", title: "Pokemon Blue Prices GameBoy | PriceCharting", url: "https://www.pricecharting.com/game/gameboy/pokemon-blue", lastModified: minutesAgo(12) },
  { id: "s3", title: "Products · Volt Demo · Shopify", url: "https://admin.shopify.com/store/volt-demo/products", lastModified: minutesAgo(35) },
  { id: "s4", title: "Nintendo Switch OLED - Best Buy", url: "https://www.bestbuy.com/site/nintendo-switch-oled/6470923.p", lastModified: minutesAgo(90) },
  { id: "s5", title: "Google Search: 0045496882648", url: "https://www.google.com/search?q=0045496882648", lastModified: minutesAgo(180) },
].map((tab) => ({ ...tab, active: false, windowId: 1 }));

export const bookmarkTree = [{
  id: "0",
  title: "",
  children: [{
    id: "1",
    title: "Bookmarks bar",
    children: [
      { id: "10", title: "eBay Seller Hub", url: "https://www.ebay.com/sh/ovw" },
      { id: "11", title: "PriceCharting", url: "https://www.pricecharting.com/" },
      { id: "12", title: "Shopify admin", url: "https://admin.shopify.com/" },
      { id: "13", title: "USPS Click-N-Ship", url: "https://cns.usps.com/" },
    ],
  }],
}];
