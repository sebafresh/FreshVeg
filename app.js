/* Seba Fresh V1 - plain JavaScript, no framework.
   Product source: published Google Sheet CSV.
   IMPORTANT: set CONFIG.sheetCsvUrl and CONFIG.storeLocation.
*/

const CONFIG = {
  brand: "Seba Fresh",
  whatsappNumber: "916300614017",
  gstPercent: 0,

  // Delivery policy requested:
  freeDeliveryKm: 5,
  maxDeliveryKm: 10,
  deliveryCharge: 30,

  // Global quantity defaults. Product rows can override these.
  globalWeight: { qty: 500, unit: "g" },
  globalVolume: { qty: 1, unit: "L" },

  // REQUIRED: replace with the real Seba Fresh base/store coordinates.
  // These coordinates are used for the driving-distance calculation.
  storeLocation: { lat: 0, lng: 0, label: "Seba Fresh" },

  // REQUIRED: paste your Google Sheets "Publish to web" CSV URL here.
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTSSJEF3_D8B3Y3kbh_3X69Cj4DsVGz9Cb8LXlAlLe7q9gD8BcN_MXnZzoHq63iUMPa3XW2oXf51TzP/pub?output=csv"
};

let products = [];
let cart = [];
let selectedCategory = "All";
let map = null;
let placeAutocomplete = null;
let selectedLocation = null;
let storeMarker = null;
let customerMarker = null;
let RouteClass = null;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();
  bindUI();
  loadProducts();
  showPageFromLinks();
});

function bindUI() {
  document.getElementById("searchInput").addEventListener("input", renderProducts);
  document.getElementById("openCart").addEventListener("click", openCart);
  document.getElementById("closeCart").addEventListener("click", closeCart);
  document.getElementById("drawerBackdrop").addEventListener("click", closeCart);
  document.getElementById("checkoutBtn").addEventListener("click", showCheckout);
  document.getElementById("whatsappBtn").addEventListener("click", sendWhatsAppOrder);
  document.getElementById("closeModal").addEventListener("click", () => document.getElementById("pageModal").classList.remove("open"));

  document.querySelectorAll("[data-page]").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      openInfoPage(a.dataset.page);
    });
  });

  document.getElementById("menuBtn").addEventListener("click", () => {
    const nav = document.querySelector(".navlinks");
    const visible = nav.style.display === "flex";
    nav.style.display = visible ? "" : "flex";
    nav.style.flexDirection = "column";
    nav.style.position = "absolute";
    nav.style.right = "10px";
    nav.style.top = "62px";
    nav.style.background = "#fff";
    nav.style.padding = "14px";
    nav.style.borderRadius = "14px";
    nav.style.boxShadow = "0 15px 35px rgba(0,0,0,.12)";
  });
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  const latest = document.getElementById("latestGrid");

  if (!CONFIG.sheetCsvUrl || CONFIG.sheetCsvUrl.includes("PASTE_YOUR")) {
    grid.innerHTML = `<div class="error">Google Sheet is not connected yet. Open <b>app.js</b> and paste your published CSV URL into <b>CONFIG.sheetCsvUrl</b>.</div>`;
    latest.innerHTML = `<div class="empty">Connect the Google Sheet to show products.</div>`;
    renderCategories([]);
    return;
  }

  try {
    const url = CONFIG.sheetCsvUrl + (CONFIG.sheetCsvUrl.includes("?") ? "&" : "?") + "_=" + Date.now();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Google Sheet request failed: " + response.status);
    const csv = await response.text();
    const rows = parseCSV(csv);
    products = rows.map(normalizeProduct).filter(p => p.name && p.available);
    if (!products.length) throw new Error("No available products were found in the published sheet.");
    renderCategories(products);
    renderProducts();
    renderLatest();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="error">Could not load the product sheet. Check that the Google Sheet is published as CSV and the URL in app.js is correct.</div>`;
    latest.innerHTML = `<div class="empty">Products could not be loaded.</div>`;
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); if (row.some(v => v.trim() !== "")) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function normalizeProduct(r) {
  const quantityType = (r.quantity_type || r.unittype || r.type || "weight").toLowerCase();
  const defaultUnit = r.default_unit || r.quantity_unit || r.unit || (quantityType === "volume" ? CONFIG.globalVolume.unit : CONFIG.globalWeight.unit);
  const priceUnit = r.price_unit || r.pricing_unit || (quantityType === "volume" ? "L" : "kg");
  const defaultQty = Number(r.default_qty || r.default_quantity || 0);
  const step = Number(r.step_qty || r.quantity_step || 0);
  return {
    id: r.id || cryptoRandomId(),
    name: r.name || r.product || "",
    category: r.category || "Other",
    price: Number(r.price || 0),
    priceUnit,
    quantityType: quantityType === "volume" ? "volume" : "weight",
    defaultQty: defaultQty > 0 ? defaultQty : null,
    defaultUnit: normalizeUnit(defaultUnit),
    step: step > 0 ? step : null,
    minQty: Number(r.min_qty || r.min_quantity || 0) || null,
    image: r.image || r.image_url || "",
    available: !["no","false","0","out of stock"].includes((r.available || "yes").toLowerCase()),
    featured: ["yes","true","1","latest","featured"].includes((r.featured || r.latest || "").toLowerCase()),
    description: r.description || ""
  };
}

function normalizeUnit(u) {
  const x = String(u).trim().toLowerCase();
  if (x === "kg" || x === "kilogram" || x === "kilograms") return "kg";
  if (x === "g" || x === "gram" || x === "grams") return "g";
  if (x === "l" || x === "litre" || x === "liter" || x === "liters" || x === "litres") return "L";
  if (x === "ml" || x === "millilitre" || x === "milliliter") return "ml";
  return u || "g";
}

function renderCategories(list) {
  const cats = ["All", ...new Set(list.map(p => p.category).filter(Boolean))];
  const el = document.getElementById("categoryChips");
  el.innerHTML = cats.map(c => `<button class="chip ${selectedCategory === c ? "active" : ""}" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join("");
  el.querySelectorAll("[data-category]").forEach(btn => btn.addEventListener("click", () => {
    selectedCategory = btn.dataset.category;
    renderCategories(products);
    renderProducts();
  }));
}

function renderProducts() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered = products.filter(p =>
    (selectedCategory === "All" || p.category === selectedCategory) &&
    (!query || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query))
  );
  document.getElementById("productGrid").innerHTML = filtered.length
    ? filtered.map(productCard).join("")
    : `<div class="empty">No products found.</div>`;
  bindProductCards();
}

function renderLatest() {
  const list = products.filter(p => p.featured).slice(0, 8);
  document.getElementById("latestGrid").innerHTML = list.length
    ? list.map(productCard).join("")
    : `<div class="empty">Mark products as <b>featured=yes</b> in Google Sheets to show them here.</div>`;
  bindProductCards();
}

function productCard(p) {
  const defaults = getDefaultQuantity(p);
  const units = p.quantityType === "volume" ? ["ml","L"] : ["g","kg"];
  const initialUnit = defaults.unit;
  const initialQty = defaults.qty;
  const img = p.image
    ? `<img loading="lazy" src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span class="emoji-img" style="display:none">🥬</span>`
    : `<span class="emoji-img">${vegetableEmoji(p.name)}</span>`;
  return `<article class="product" data-product="${escapeAttr(p.id)}">
    <div class="product-img">${img}</div>
    <div class="product-body">
      <div class="product-category">${escapeHTML(p.category)}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="product-desc">${escapeHTML(p.description)}</div>
      <div class="price">₹${money(p.price)} <small>/ ${escapeHTML(p.priceUnit)}</small></div>
      <div class="qty-line">
        <input class="qty-input" type="number" min="${p.minQty || 1}" step="${p.step || 1}" value="${initialQty}" aria-label="Quantity">
        <select class="unit-select" aria-label="Unit">${units.map(u => `<option value="${u}" ${u === initialUnit ? "selected" : ""}>${u}</option>`).join("")}</select>
      </div>
      <button class="add" data-add="${escapeAttr(p.id)}">Add to cart</button>
    </div>
  </article>`;
}

function bindProductCards() {
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".product");
      const p = products.find(x => x.id === btn.dataset.add);
      const qty = Number(card.querySelector(".qty-input").value);
      const unit = card.querySelector(".unit-select").value;
      if (!p || !qty || qty <= 0) return toast("Enter a valid quantity.");
      addToCart(p, qty, unit);
    });
  });
}

function getDefaultQuantity(p) {
  if (p.defaultQty && p.defaultUnit) return { qty: p.defaultQty, unit: p.defaultUnit };
  return p.quantityType === "volume" ? CONFIG.globalVolume : CONFIG.globalWeight;
}

function addToCart(p, qty, unit) {
  const baseQty = toBaseQuantity(qty, unit);
  const existing = cart.find(i => i.productId === p.id && i.baseQty === baseQty);
  if (existing) existing.count++;
  else cart.push({ productId: p.id, baseQty, count: 1 });
  renderCart();
  toast(`${p.name} added to cart`);
}

function toBaseQuantity(qty, unit) {
  return unit === "kg" ? qty * 1000 : unit === "L" ? qty * 1000 : qty;
}
function fromBaseQuantity(base, unit) {
  return unit === "kg" || unit === "L" ? base / 1000 : base;
}
function displayQuantity(base, type) {
  const kgOrL = type === "volume" ? "L" : "kg";
  const small = type === "volume" ? "ml" : "g";
  if (base >= 1000) return `${formatNumber(base / 1000)} ${kgOrL}`;
  return `${formatNumber(base)} ${small}`;
}
function pricingQuantity(base, priceUnit) {
  const u = normalizeUnit(priceUnit);
  return (u === "kg" || u === "L") ? base / 1000 : base;
}

function renderCart() {
  document.getElementById("cartCount").textContent = cart.reduce((s, i) => s + i.count, 0);
  const items = cart.map((item, index) => {
    const p = products.find(x => x.id === item.productId);
    const line = lineTotal(p, item.baseQty) * item.count;
    return `<div class="cart-item">
      <div><b>${escapeHTML(p.name)}</b><br><small>${displayQuantity(item.baseQty, p.quantityType)} × ${item.count}</small></div>
      <div style="text-align:right"><b>₹${money(line)}</b><div class="cart-controls"><button class="icon-btn" data-cart-dec="${index}">−</button><button class="icon-btn" data-cart-inc="${index}">+</button><button class="icon-btn" data-cart-remove="${index}">×</button></div></div>
    </div>`;
  }).join("");
  document.getElementById("cartItems").innerHTML = items || `<div class="empty">Your cart is empty.<br><br><a href="#shop" onclick="closeCart()">Start shopping</a></div>`;

  document.querySelectorAll("[data-cart-inc]").forEach(b => b.onclick = () => { cart[b.dataset.cartInc].count++; renderCart(); });
  document.querySelectorAll("[data-cart-dec]").forEach(b => b.onclick = () => { const i = cart[b.dataset.cartDec]; i.count--; if(i.count<=0) cart.splice(b.dataset.cartDec,1); renderCart(); });
  document.querySelectorAll("[data-cart-remove]").forEach(b => () => {});
  document.querySelectorAll("[data-cart-remove]").forEach(b => b.onclick = () => { cart.splice(Number(b.dataset.cartRemove),1); renderCart(); });

  updateSummary();
}

function lineTotal(p, baseQty) {
  return pricingQuantity(baseQty, p.priceUnit) * p.price;
}

function cartSubtotal() {
  return cart.reduce((sum, i) => {
    const p = products.find(x => x.id === i.productId);
    return sum + lineTotal(p, i.baseQty) * i.count;
  }, 0);
}

function updateSummary(distanceKm = null, deliveryCharge = 0) {
  const subtotal = cartSubtotal();
  const gst = subtotal * CONFIG.gstPercent / 100;
  const total = subtotal + gst + deliveryCharge;
  document.getElementById("cartSummary").innerHTML = `
    <div class="summary-row"><span>Subtotal</span><b>₹${money(subtotal)}</b></div>
    <div class="summary-row"><span>GST (${CONFIG.gstPercent}%)</span><b>₹${money(gst)}</b></div>
    <div class="summary-row"><span>Delivery ${distanceKm !== null ? `(${formatNumber(distanceKm)} km)` : ""}</span><b>${deliveryCharge ? "₹"+money(deliveryCharge) : "Free"}</b></div>
    <div class="summary-row total"><span>Total</span><span>₹${money(total)}</span></div>`;
}

function openCart() {
  document.getElementById("cartDrawer").classList.add("open");
  document.getElementById("drawerBackdrop").classList.add("open");
  renderCart();
}
function closeCart() {
  document.getElementById("cartDrawer").classList.remove("open");
  document.getElementById("drawerBackdrop").classList.remove("open");
}
function showCheckout() {
  if (!cart.length) return toast("Your cart is empty.");
  document.getElementById("checkoutForm").style.display = "block";
  document.getElementById("checkoutBtn").style.display = "none";
  document.getElementById("whatsappBtn").style.display = "block";
  initMapIfPossible();
  document.getElementById("cartDrawer").scrollTop = 0;
  document.querySelector(".drawer-body").scrollTop = 0;
}

async function initSebaMaps() {
  try {
    const [{ Map, Marker }, { PlaceAutocompleteElement }, { Route }] = await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("places"),
      google.maps.importLibrary("routes")
    ]);
    RouteClass = Route;
    window.SebaMapLib = { Map, Marker, PlaceAutocompleteElement };
    initMapIfPossible();
  } catch (e) {
    console.error("Google Maps initialization failed", e);
    document.getElementById("locationStatus").innerHTML = `<span class="bad">Map could not load. Check your Google Maps API key and enabled APIs.</span>`;
  }
}
window.initSebaMaps = initSebaMaps;

function validStoreLocation() {
  return Number.isFinite(CONFIG.storeLocation.lat) && Number.isFinite(CONFIG.storeLocation.lng) &&
    !(CONFIG.storeLocation.lat === 0 && CONFIG.storeLocation.lng === 0);
}

function initMapIfPossible() {
  if (!window.SebaMapLib || map || !validStoreLocation()) return;
  const { Map, Marker, PlaceAutocompleteElement } = window.SebaMapLib;
  const center = { lat: CONFIG.storeLocation.lat, lng: CONFIG.storeLocation.lng };
  map = new Map(document.getElementById("map"), { center, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, mapId: "DEMO_MAP_ID" });
  storeMarker = new Marker({ map, position: center, title: "Seba Fresh" });

  placeAutocomplete = new PlaceAutocompleteElement();
  placeAutocomplete.placeholder = "Search your delivery location…";
  placeAutocomplete.setAttribute("included-region-codes", "in");
  document.getElementById("placeSearch").replaceWith(placeAutocomplete);
  placeAutocomplete.addEventListener("gmp-select", async ({ placePrediction }) => {
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "id"] });
      if (!place.location) return;
      setSelectedLocation(place.location.lat(), place.location.lng(), place.formattedAddress || place.displayName || "Selected location", place.id || "");
      map.panTo(place.location); map.setZoom(16);
    } catch (e) { console.error(e); toast("Could not read that location."); }
  });

  map.addListener("click", e => {
    if (e.latLng) setSelectedLocation(e.latLng.lat(), e.latLng.lng(), "Map selected location", "");
  });
}

async function setSelectedLocation(lat, lng, address, placeId) {
  selectedLocation = { lat, lng, address, placeId };
  if (window.SebaMapLib && map) {
    const { Marker } = window.SebaMapLib;
    if (customerMarker) customerMarker.setMap(null);
    customerMarker = new Marker({ map, position: { lat, lng }, title: "Delivery location" });
  }
  const status = document.getElementById("locationStatus");
  status.textContent = "Checking driving distance…";
  status.className = "location-status";
  if (!validStoreLocation()) {
    status.innerHTML = `<span class="bad">Store location is not configured in app.js.</span>`;
    updateSummary(null, 0);
    return;
  }
  try {
    const distanceKm = await getDrivingDistanceKm({lat: CONFIG.storeLocation.lat, lng: CONFIG.storeLocation.lng}, {lat, lng});
    if (distanceKm > CONFIG.maxDeliveryKm) {
      selectedLocation.distanceKm = distanceKm;
      selectedLocation.deliveryCharge = null;
      status.innerHTML = `<span class="bad">This location is ${formatNumber(distanceKm)} km away. Seba Fresh currently delivers only within ${CONFIG.maxDeliveryKm} km.</span>`;
      updateSummary(distanceKm, 0);
      return;
    }
    const charge = distanceKm > CONFIG.freeDeliveryKm ? CONFIG.deliveryCharge : 0;
    selectedLocation.distanceKm = distanceKm;
    selectedLocation.deliveryCharge = charge;
    status.innerHTML = `<span class="ok">Delivery available: ${formatNumber(distanceKm)} km by road • ${charge ? "₹"+money(charge)+" delivery charge" : "Free delivery"}.</span>`;
    updateSummary(distanceKm, charge);
  } catch (e) {
    console.error(e);
    selectedLocation = null;
    status.innerHTML = `<span class="bad">Unable to calculate driving distance. Please try the location again.</span>`;
    updateSummary(null, 0);
  }
}

async function getDrivingDistanceKm(origin, destination) {
  if (!RouteClass) throw new Error("Routes library not ready.");
  const request = {
    origin,
    destination,
    travelMode: "DRIVING",
    routingPreference: "TRAFFIC_UNAWARE",
    fields: ["legs"]
  };
  const result = await RouteClass.computeRoutes(request);
  if (!result.routes || !result.routes.length) throw new Error("No route found.");
  const meters = result.routes[0].legs.reduce((sum, leg) => sum + (leg.distanceMeters || 0), 0);
  if (!meters) throw new Error("Route has no distance.");
  return meters / 1000;
}

function validateCheckout() {
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.replace(/\D/g, "");
  const address = document.getElementById("deliveryAddress").value.trim();
  if (!name) return "Please enter your name.";
  if (!/^[6-9]\d{9}$/.test(phone)) return "Please enter a valid 10-digit Indian mobile number.";
  if (!selectedLocation || selectedLocation.deliveryCharge === null) return "Please select a delivery location within 10 km.";
  if (!address) return "Please enter the delivery address or landmark.";
  return "";
}

function sendWhatsAppOrder() {
  const error = validateCheckout();
  if (error) return toast(error);

  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.replace(/\D/g, "");
  const address = document.getElementById("deliveryAddress").value.trim();
  const instructions = document.getElementById("instructions").value.trim();
  const delivery = selectedLocation.deliveryCharge || 0;
  const subtotal = cartSubtotal();
  const gst = subtotal * CONFIG.gstPercent / 100;
  const total = subtotal + gst + delivery;
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${selectedLocation.lat},${selectedLocation.lng}`;

  const itemLines = cart.map((i, n) => {
    const p = products.find(x => x.id === i.productId);
    const unitPrice = lineTotal(p, i.baseQty);
    return `${n+1}. ${p.name} - ${displayQuantity(i.baseQty, p.quantityType)} × ${i.count} = ₹${money(unitPrice * i.count)}`;
  }).join("\n");

  const msg = `🥬 SEBA FRESH - SALE ORDER
━━━━━━━━━━━━━━━━━━

Customer: ${name}
Mobile: ${phone}

ITEMS
━━━━━━━━━━━━━━━━━━
${itemLines}

Subtotal: ₹${money(subtotal)}
GST (${CONFIG.gstPercent}%): ₹${money(gst)}
Delivery: ${delivery ? "₹"+money(delivery) : "FREE"}
TOTAL: ₹${money(total)}

DELIVERY LOCATION
━━━━━━━━━━━━━━━━━━
${selectedLocation.address}
Distance: ${formatNumber(selectedLocation.distanceKm)} km
Google Maps: ${mapsLink}

DELIVERY ADDRESS / LANDMARK
${address}

${instructions ? `DELIVERY INSTRUCTIONS
${instructions}\n` : ""}━━━━━━━━━━━━━━━━━━
Please confirm the sale order.

Seba Fresh
WhatsApp: 6300614017`;

  window.open(`https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
}

function openInfoPage(page) {
  const pages = {
    privacy: ["Privacy Policy", `<p>Seba Fresh uses customer information only to process and deliver orders. Information entered on this website may include name, mobile number, delivery address, selected location and delivery instructions. The sale order is sent to Seba Fresh through WhatsApp when the customer chooses to submit it.</p><p>The product catalog is read from the published product sheet. Do not store private customer information in the public product sheet.</p>`],
    terms: ["Terms & Conditions", `<p>Product availability and prices are subject to confirmation by Seba Fresh. The website prepares a sale-order request; an order is considered confirmed only after Seba Fresh confirms it through WhatsApp or another agreed channel.</p><p>Displayed totals are calculated from the catalog available at the time of ordering. Final invoice details may be confirmed before delivery.</p>`],
    delivery: ["Delivery Information", `<p>Delivery is available within a maximum <b>10 km driving distance</b> from the configured Seba Fresh location.</p><ul><li>Up to 5 km: free delivery.</li><li>More than 5 km and up to 10 km: ₹30 delivery charge.</li><li>More than 10 km: the website will not allow the sale order to be submitted.</li></ul><p>Delivery distance is calculated using Google Maps routing.</p>`],
    refund: ["Cancellation / Refund", `<p>Because this is a fresh-product ordering service, cancellation and refund decisions should be handled by Seba Fresh based on the status of the sale order and delivery. Contact <b>6300614017</b> for support.</p>`]
  };
  const [title, body] = pages[page] || ["Information", "<p>Information unavailable.</p>"];
  document.getElementById("modalContent").innerHTML = `<h2>${title}</h2>${body}`;
  document.getElementById("pageModal").classList.add("open");
}

function showPageFromLinks() {}

function vegetableEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes("tomato")) return "🍅";
  if (n.includes("potato")) return "🥔";
  if (n.includes("carrot")) return "🥕";
  if (n.includes("onion")) return "🧅";
  if (n.includes("garlic")) return "🧄";
  if (n.includes("chilli") || n.includes("pepper")) return "🌶️";
  if (n.includes("corn")) return "🌽";
  if (n.includes("cabbage")) return "🥬";
  if (n.includes("broccoli")) return "🥦";
  if (n.includes("cucumber")) return "🥒";
  if (n.includes("lemon")) return "🍋";
  if (n.includes("ginger")) return "🫚";
  return "🥬";
}
function money(n) { return Number(n || 0).toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2}); }
function formatNumber(n) { return Number(n || 0).toLocaleString("en-IN", {maximumFractionDigits:2}); }
function cryptoRandomId() { return "p-" + Math.random().toString(36).slice(2, 10); }
function escapeHTML(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function escapeAttr(s) { return escapeHTML(s); }
let toastTimer;
function toast(text) {
  const el = document.getElementById("toast");
  el.textContent = text; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
