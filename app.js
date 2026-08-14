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

  // ---------------------------------------------------------------
  // +/- STEP AMOUNTS. g/ml and kg/L are different scales and must
  // NEVER share one step number:
  //   - g / ml  -> steps by the product's own step_qty (Sheet column),
  //                falls back to DEFAULT_BASE_STEP if not set.
  //   - kg / L  -> always steps by a whole 1 kg / 1 L.
  // ---------------------------------------------------------------
  DEFAULT_BASE_STEP: 250, // grams or ml, used if a product has no step_qty
  DEFAULT_BASE_MIN: 250,  // grams or ml, used if a product has no min_qty

  // REQUIRED: replace with the real Seba Fresh base/store coordinates.
  // These coordinates are used for the driving-distance calculation.
  storeLocation: { lat: 17.46690654239371, lng: 78.34280212890498, label: "Seba Fresh" },

  // Default product image used when the Sheet Image column is blank
  // or the supplied image cannot be loaded.
  defaultProductImage: "images/default-vegetable.jpg",

  // REQUIRED: paste your Google Sheets "Publish to web" CSV URL here.
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTSSJEF3_D8B3Y3kbh_3X69Cj4DsVGz9Cb8LXlAlLe7q9gD8BcN_MXnZzoHq63iUMPa3XW2oXf51TzP/pub?output=csv"
};

let products = [];

// Cart: ONE entry per product => { productId, qty, unit }
// Never store duplicate lines for the same product.
let cart = [];

let selectedCategory = "All";
let selectedLocation = null;
let locationRequestInProgress = false;
let locationButtonTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("year").textContent = new Date().getFullYear();
  bindUI();
  bindProductEvents();   // delegated listeners — attached once, never re-added
  loadProducts();

  // Ask for the customer's current location shortly after the page loads.
  setTimeout(() => requestCurrentLocation(false), 700);
});

function bindUI() {
  document.getElementById("searchInput").addEventListener("input", renderProducts);
  document.getElementById("openCart").addEventListener("click", openCart);
  document.getElementById("closeCart").addEventListener("click", closeCart);
  document.getElementById("drawerBackdrop").addEventListener("click", closeCart);
  document.getElementById("checkoutBtn").addEventListener("click", showCheckout);
  document.getElementById("whatsappBtn").addEventListener("click", sendWhatsAppOrder);
  document.getElementById("shareLocationBtn").addEventListener("click", () => requestCurrentLocation(true));
  document.getElementById("closeModal").addEventListener("click", () => document.getElementById("pageModal").classList.remove("open"));

  // Close the info modal by clicking its dark backdrop too, not just the × button.
  document.getElementById("pageModal").addEventListener("click", (e) => {
    if (e.target.id === "pageModal") document.getElementById("pageModal").classList.remove("open");
  });

  // Escape key closes whichever overlay is open.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.getElementById("pageModal").classList.remove("open");
    closeCart();
  });

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

// ---------------------------------------------------------------
// DUMMY PRODUCTS — shown automatically when running on localhost
// so you can develop without a live Google Sheet.
// Images use Unsplash Source URLs which work in any browser
// (no API key needed) and also work on GitHub Pages.
// ---------------------------------------------------------------
const DUMMY_PRODUCTS = [
  { id:"d-1", name:"Tomato",     category:"Vegetables", price:40,  priceUnit:"kg", quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1546470427-e26264be0b11?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:true,  description:"Fresh red tomatoes" },
  { id:"d-2", name:"Potato",     category:"Vegetables", price:30,  priceUnit:"kg", quantityType:"weight", defaultQty:1,   defaultUnit:"kg",step:1,   minQty:1,   image:"https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:true,  description:"Fresh potatoes" },
  { id:"d-3", name:"Onion",      category:"Vegetables", price:35,  priceUnit:"kg", quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1508747703725-719777637510?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Red onions" },
  { id:"d-4", name:"Carrot",     category:"Vegetables", price:50,  priceUnit:"kg", quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:true,  description:"Crunchy carrots" },
  { id:"d-5", name:"Spinach",    category:"Leafy",      price:20,  priceUnit:"kg", quantityType:"weight", defaultQty:250, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh spinach leaves" },
  { id:"d-6", name:"Cabbage",    category:"Leafy",      price:25,  priceUnit:"kg", quantityType:"weight", defaultQty:1,   defaultUnit:"kg",step:1,   minQty:1,   image:"https://images.unsplash.com/photo-1594282486552-05b4d80fbb9f?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:true,  description:"Farm fresh cabbage" },
  { id:"d-7", name:"Broccoli",   category:"Vegetables", price:80,  priceUnit:"kg", quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1459411621453-7b03977f4bfc?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Green broccoli florets" },
  { id:"d-8", name:"Cucumber",   category:"Vegetables", price:30,  priceUnit:"kg", quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh cucumbers" },
  { id:"d-9", name:"Coconut Oil",category:"Oils",       price:180, priceUnit:"L",  quantityType:"volume",  defaultQty:1,   defaultUnit:"L", step:1,   minQty:1,   image:"https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:true,  description:"Pure coconut oil" },
  { id:"d-10",name:"Lemon",      category:"Fruits",     price:60,  priceUnit:"kg", quantityType:"weight", defaultQty:250, defaultUnit:"g", step:250, minQty:250, image:"https://images.unsplash.com/photo-1590502593747-42a996133562?w=400&q=80", defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh lemons" }
];

function isLocalhost() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  const latest = document.getElementById("latestGrid");

  // On localhost — load dummy data immediately so development works offline.
  if (isLocalhost()) {
    console.info("[Seba Fresh] Running on localhost — using dummy products. Deploy to GitHub Pages to use the live Google Sheet.");
    products = DUMMY_PRODUCTS;
    renderCategories(products);
    renderProducts();
    renderLatest();
    return;
  }

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
    // Supports the Google Sheet/Excel Image column (case-insensitive header
    // normalization happens in parseCSV) and image_url as a fallback.
    image: r.image || r.image_url || "",
    defaultImage: CONFIG.defaultProductImage,
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

// ---------------------------------------------------------------
// QUANTITY / UNIT RULES
// ---------------------------------------------------------------

const UNIT_FACTOR = { g: 1, kg: 1000, ml: 1, L: 1000 };

function toBaseQty(qty, unit) { return qty * (UNIT_FACTOR[unit] || 1); }

/**
 * Step size for +/-. g/ml step by the product's own step_qty (Sheet
 * column) because 250g vs 50g makes sense per product. kg/L always
 * step by a whole unit (1 kg, 1 L) so the fine unit doesn't jump
 * around when someone is ordering by the big unit.
 */
function stepFor(p, unit) {
  if (unit === "kg" || unit === "L") return 1;
  return p.step || CONFIG.DEFAULT_BASE_STEP;
}

function minFor(p, unit) {
  if (unit === "kg" || unit === "L") return 1;
  return p.minQty || p.step || CONFIG.DEFAULT_BASE_MIN;
}

function getDefaultQuantity(p) {
  if (p.defaultQty && p.defaultUnit) return { qty: p.defaultQty, unit: p.defaultUnit };
  return p.quantityType === "volume" ? CONFIG.globalVolume : CONFIG.globalWeight;
}

/** Price for a given qty+unit against a product's per-price_unit price. */
function lineTotal(p, qty, unit) {
  const base = toBaseQty(qty, unit);
  const priceUnitBase = UNIT_FACTOR[normalizeUnit(p.priceUnit)] || 1;
  const raw = (base / priceUnitBase) * p.price;
  return Math.round(raw * 100) / 100;
}

function cartItemFor(productId) { return cart.find(i => i.productId === productId) || null; }

// ---------------------------------------------------------------
// PRODUCT CARD
// ---------------------------------------------------------------

function productCard(p) {
  const inCart = cartItemFor(p.id);
  const units = p.quantityType === "volume" ? ["ml", "L"] : ["g", "kg"];
  const defaults = getDefaultQuantity(p);

  const imageSource = p.image || p.defaultImage;

  const img = imageSource
    ? `<img loading="lazy" src="${escapeAttr(imageSource)}" alt="${escapeAttr(p.name)}"
         onerror="handleProductImageError(this, '${escapeAttr(p.name)}')">
       <span class="emoji-img" style="display:none">${vegetableEmoji(p.name)}</span>`
    : `<span class="emoji-img">${vegetableEmoji(p.name)}</span>`;

  let qtyBlock;
  if (inCart) {
    // Already in the cart: show a stepper on the CURRENT unit, plus a unit
    // select. Changing that unit removes the item and resets qty to 0 —
    // it never silently converts the number (see changeUnit()).
    qtyBlock = `
      <div class="in-cart-row"><span class="in-cart-badge">✓ In cart — ₹${money(lineTotal(p, inCart.qty, inCart.unit))}</span>
        <button class="remove-link" data-remove="${escapeAttr(p.id)}">Remove</button>
      </div>
      <div class="stepper">
        <button type="button" data-dec="${escapeAttr(p.id)}" aria-label="Decrease quantity">−</button>
        <span class="qty-val">${formatNumber(inCart.qty)}</span>
        <select data-unit-change="${escapeAttr(p.id)}" aria-label="Unit">
          ${units.map(u => `<option value="${u}" ${u === inCart.unit ? "selected" : ""}>${u}</option>`).join("")}
        </select>
        <button type="button" data-inc="${escapeAttr(p.id)}" aria-label="Increase quantity">+</button>
      </div>`;
  } else {
    // Not yet in cart: pre-fill with the product's default quantity so the
    // customer can press "Add to cart" immediately without typing anything.
    qtyBlock = `
      <div class="qty-line">
        <input class="qty-input" type="number" min="0" step="${stepFor(p, defaults.unit)}" value="${defaults.qty}" data-qty-field="${escapeAttr(p.id)}" aria-label="Quantity">
        <select class="unit-select" data-unit-pre="${escapeAttr(p.id)}" aria-label="Unit">
          ${units.map(u => `<option value="${u}" ${u === defaults.unit ? "selected" : ""}>${u}</option>`).join("")}
        </select>
      </div>
      <button class="add" data-add="${escapeAttr(p.id)}">Add to cart</button>`;
  }

  return `<article class="product" data-product="${escapeAttr(p.id)}">
    <div class="product-img">${img}</div>
    <div class="product-body">
      <div class="product-category">${escapeHTML(p.category)}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="product-desc">${escapeHTML(p.description)}</div>
      <div class="price">₹${money(p.price)} <small>/ ${escapeHTML(p.priceUnit)}</small></div>
      ${qtyBlock}
    </div>
  </article>`;
}

// ---------------------------------------------------------------
// EVENT DELEGATION — attached ONCE on DOMContentLoaded so that
// re-renders (renderProducts / renderLatest / renderCart) never
// stack up duplicate listeners, which was the root cause of the
// "quantity doubles on every +/- click" bug.
// ---------------------------------------------------------------

function bindProductEvents() {
  // Delegate from both grids and the cart drawer to catch all cards.
  ["productGrid", "latestGrid", "cartItems"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("click", e => {
      const t = e.target;

      // Add to cart button
      const addId = t.closest("[data-add]")?.dataset.add;
      if (addId) {
        const p = products.find(x => x.id === addId);
        const card = t.closest(".product");
        const unit = card.querySelector("[data-unit-pre]").value;
        const qty  = Number(card.querySelector("[data-qty-field]").value);
        addToCart(p, qty, unit);
        return;
      }

      // Increment / decrement on in-cart stepper (product card)
      const incId = t.closest("[data-inc]")?.dataset.inc;
      if (incId) { changeQty(incId,  1); return; }
      const decId = t.closest("[data-dec]")?.dataset.dec;
      if (decId) { changeQty(decId, -1); return; }

      // Remove from card
      const removeId = t.closest("[data-remove]")?.dataset.remove;
      if (removeId) { removeFromCart(removeId); return; }

      // Cart drawer +/- / remove
      const cartInc = t.closest("[data-cart-inc]")?.dataset.cartInc;
      if (cartInc) { changeQty(cartInc,  1); return; }
      const cartDec = t.closest("[data-cart-dec]")?.dataset.cartDec;
      if (cartDec) { changeQty(cartDec, -1); return; }
      const cartRm  = t.closest("[data-cart-remove]")?.dataset.cartRemove;
      if (cartRm)  { removeFromCart(cartRm);  return; }
    });

    el.addEventListener("change", e => {
      const t = e.target;

      // Pre-add unit change: update step on the qty input, reset to default qty
      const prePid = t.dataset.unitPre;
      if (prePid) {
        const p = products.find(x => x.id === prePid);
        const card = t.closest(".product");
        const field = card.querySelector("[data-qty-field]");
        field.step  = stepFor(p, t.value);
        // Reset to the product's default for the newly selected unit
        const defaults = getDefaultQuantity(p);
        field.value = (t.value === defaults.unit) ? defaults.qty : minFor(p, t.value);
        return;
      }

      // Post-add (in-cart) unit change
      const changePid = t.dataset.unitChange;
      if (changePid) { changeUnit(changePid); return; }
    });
  });
}

// Keep bindProductCards as a no-op so existing call-sites don't break,
// but all the real work is done by the delegated listeners above.
function bindProductCards() {}

// ---------------------------------------------------------------
// CART OPERATIONS
// ---------------------------------------------------------------

function addToCart(p, qty, unit) {
  const min = minFor(p, unit);
  if (!qty || qty < min) return toast(`Minimum quantity is ${min} ${unit}`);

  const existing = cartItemFor(p.id);
  if (existing) { existing.qty = qty; existing.unit = unit; }
  else cart.push({ productId: p.id, qty, unit });

  renderProducts();
  renderLatest();
  renderCart();
  toast(`${p.name} added to cart`);
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.productId !== productId);
  renderProducts();
  renderLatest();
  renderCart();
}

/** +/- respects the CURRENT unit's own step/min (see stepFor/minFor). */
function changeQty(productId, direction) {
  const item = cartItemFor(productId);
  if (!item) return;
  const p = products.find(x => x.id === productId);
  const step = stepFor(p, item.unit);
  const min = minFor(p, item.unit);
  const newQty = direction > 0 ? item.qty + step : item.qty - step;

  if (newQty < min) { removeFromCart(productId); return; }
  item.qty = Math.round(newQty * 1000) / 1000;
  renderProducts();
  renderLatest();
  renderCart();
}

/**
 * MANDATORY RULE: changing the unit of a product already in the cart
 * (g -> kg or kg -> g, ml -> L or L -> ml) REMOVES it from the cart and
 * resets the quantity field to 0. The quantity is never converted. The
 * customer must re-enter a quantity and press "Add to cart" again.
 */
function changeUnit(productId) {
  const existed = cartItemFor(productId);
  if (!existed) return;
  cart = cart.filter(i => i.productId !== productId);
  renderProducts();
  renderLatest();
  renderCart();
  const p = products.find(x => x.id === productId);
  toast(`Unit changed — quantity reset to 0. Please re-enter and add ${p ? p.name : "the item"} again.`);
}

function cartSubtotal() {
  return cart.reduce((sum, i) => {
    const p = products.find(x => x.id === i.productId);
    return sum + (p ? lineTotal(p, i.qty, i.unit) : 0);
  }, 0);
}

function renderCart() {
  document.getElementById("cartCount").textContent = cart.length;

  const items = cart.map(item => {
    const p = products.find(x => x.id === item.productId);
    if (!p) return "";
    const line = lineTotal(p, item.qty, item.unit);
    return `<div class="cart-item">
      <div><b>${escapeHTML(p.name)}</b><br><small>${formatNumber(item.qty)} ${escapeHTML(item.unit)}</small></div>
      <div style="text-align:right"><b>₹${money(line)}</b>
        <div class="cart-controls">
          <button class="icon-btn" data-cart-dec="${escapeAttr(item.productId)}">−</button>
          <button class="icon-btn" data-cart-inc="${escapeAttr(item.productId)}">+</button>
          <button class="icon-btn" data-cart-remove="${escapeAttr(item.productId)}">×</button>
        </div>
      </div>
    </div>`;
  }).join("");

  document.getElementById("cartItems").innerHTML = items || `<div class="empty">Your cart is empty.<br><br><a href="#shop" onclick="closeCart()">Start shopping</a></div>`;

  // No listener re-attachment needed — cart buttons are handled by
  // the delegated listener set up in bindProductEvents().

  updateSummary(
    selectedLocation && selectedLocation.distanceKm != null ? selectedLocation.distanceKm : null,
    selectedLocation && selectedLocation.deliveryCharge ? selectedLocation.deliveryCharge : 0
  );
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
  // If the customer has not shared location yet, give them a clear button.
  updateLocationUI();
  document.getElementById("cartDrawer").scrollTop = 0;
  document.querySelector(".drawer-body").scrollTop = 0;
}

// ---------------------------------------------------------------
 // DELIVERY LOCATION
 // ---------------------------------------------------------------
 // No map is displayed. The browser Geolocation API captures the
 // customer's current coordinates. A Google Maps link is generated
 // from those coordinates for the WhatsApp order.
 // If the customer cannot share browser location, they can paste a
 // Google Maps link into Delivery instructions. Coordinates are used
 // when they can be extracted from the link.

 function validStoreLocation() {
   return Number.isFinite(CONFIG.storeLocation.lat) &&
     Number.isFinite(CONFIG.storeLocation.lng) &&
     !(CONFIG.storeLocation.lat === 0 && CONFIG.storeLocation.lng === 0);
 }

 function updateLocationUI(highlight = false) {
   const btn = document.getElementById("shareLocationBtn");
   const status = document.getElementById("locationStatus");
   if (!btn || !status) return;

   btn.classList.toggle("location-highlight", !!highlight);

   if (selectedLocation && selectedLocation.deliveryCharge !== null) {
     btn.textContent = "✓ Current Location Captured";
     status.innerHTML =
       `<span class="ok">Location captured. Delivery distance: ${formatNumber(selectedLocation.distanceKm)} km • ` +
       `${selectedLocation.deliveryCharge ? "₹"+money(selectedLocation.deliveryCharge)+" delivery charge" : "Free delivery"}.</span>`;
     return;
   }

   btn.textContent = "📍 Share My Current Location";
   if (!selectedLocation) {
     status.innerHTML =
       `<span class="bad">Delivery location is required. Tap the button to share your current location.</span>`;
   }
 }

 function requestCurrentLocation(fromButton = false) {
   const status = document.getElementById("locationStatus");
   const btn = document.getElementById("shareLocationBtn");

   if (!navigator.geolocation) {
     if (status) status.innerHTML =
       `<span class="bad">Location sharing is not supported by this browser. Please paste a Google Maps location link in the instructions.</span>`;
     if (fromButton) highlightLocationButton();
     return;
   }

   if (locationRequestInProgress) return;
   locationRequestInProgress = true;

   if (btn) {
     btn.disabled = true;
     btn.textContent = "📍 Getting your location…";
   }
   if (status) status.innerHTML = `<span>Requesting your current location…</span>`;

   navigator.geolocation.getCurrentPosition(
     async position => {
       locationRequestInProgress = false;
       const lat = position.coords.latitude;
       const lng = position.coords.longitude;
       const accuracy = Math.round(position.coords.accuracy || 0);

       try {
         await setSelectedLocation(
           lat,
           lng,
           "Customer current location",
           "",
           accuracy
         );
       } finally {
         if (btn) btn.disabled = false;
         updateLocationUI();
       }
     },
     error => {
       locationRequestInProgress = false;
       if (btn) btn.disabled = false;

       let message = "Could not get your current location.";
       if (error.code === error.PERMISSION_DENIED) {
         message = "Location permission was denied. Please allow location access, or paste a Google Maps location link in the instructions.";
       } else if (error.code === error.POSITION_UNAVAILABLE) {
         message = "Your location is currently unavailable. Please try again or paste a Google Maps location link in the instructions.";
       } else if (error.code === error.TIMEOUT) {
         message = "Location request timed out. Please try again.";
       }

       if (status) status.innerHTML = `<span class="bad">${escapeHTML(message)}</span>`;
       if (fromButton) highlightLocationButton();
     },
     {
       enableHighAccuracy: true,
       timeout: 15000,
       maximumAge: 60000
     }
   );
 }

 function highlightLocationButton() {
   const btn = document.getElementById("shareLocationBtn");
   if (!btn) return;

   btn.classList.remove("location-highlight");
   void btn.offsetWidth;
   btn.classList.add("location-highlight");

   clearTimeout(locationButtonTimer);
   locationButtonTimer = setTimeout(() => {
     btn.classList.remove("location-highlight");
   }, 3000);
 }

 async function setSelectedLocation(lat, lng, address, placeId = "", accuracy = null) {
   selectedLocation = {
     lat: Number(lat),
     lng: Number(lng),
     address: address || "Customer current location",
     placeId,
     accuracy
   };

   const status = document.getElementById("locationStatus");
   if (status) status.innerHTML = `<span>Checking delivery distance…</span>`;

   if (!validStoreLocation()) {
     selectedLocation.distanceKm = null;
     selectedLocation.deliveryCharge = null;
     if (status) status.innerHTML =
       `<span class="bad">Store location is not configured in app.js. Set CONFIG.storeLocation before taking orders.</span>`;
     updateSummary(null, 0);
     return false;
   }

   try {
     // The map has been removed, so we use straight-line distance.
     // Keep the delivery limit conservative and label it as approximate.
     const distanceKm = getDistanceKm(
       CONFIG.storeLocation.lat,
       CONFIG.storeLocation.lng,
       selectedLocation.lat,
       selectedLocation.lng
     );

     if (distanceKm > CONFIG.maxDeliveryKm) {
       selectedLocation.distanceKm = distanceKm;
       selectedLocation.deliveryCharge = null;
       if (status) status.innerHTML =
         `<span class="bad">This location is approximately ${formatNumber(distanceKm)} km away. ` +
         `Seba Fresh currently delivers only within ${CONFIG.maxDeliveryKm} km.</span>`;
       updateSummary(distanceKm, 0);
       return false;
     }

     const charge = distanceKm > CONFIG.freeDeliveryKm ? CONFIG.deliveryCharge : 0;
     selectedLocation.distanceKm = distanceKm;
     selectedLocation.deliveryCharge = charge;

     if (status) status.innerHTML =
       `<span class="ok">Delivery available: approximately ${formatNumber(distanceKm)} km ` +
       `${selectedLocation.accuracy ? `• GPS accuracy ±${selectedLocation.accuracy} m ` : ""}• ` +
       `${charge ? "₹"+money(charge)+" delivery charge" : "Free delivery"}.</span>`;

     updateSummary(distanceKm, charge);
     return true;
   } catch (e) {
     console.error(e);
     selectedLocation = null;
     if (status) status.innerHTML =
       `<span class="bad">Unable to calculate delivery distance. Please share the location again.</span>`;
     updateSummary(null, 0);
     return false;
   }
 }

 function getDistanceKm(lat1, lng1, lat2, lng2) {
   const toRad = degrees => degrees * Math.PI / 180;
   const earthRadiusKm = 6371;

   const dLat = toRad(lat2 - lat1);
   const dLng = toRad(lng2 - lng1);

   const a =
     Math.sin(dLat / 2) ** 2 +
     Math.cos(toRad(lat1)) *
     Math.cos(toRad(lat2)) *
     Math.sin(dLng / 2) ** 2;

   return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 }

 function googleMapsLinkForLocation(location) {
   if (!location) return "";
   return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.lat + "," + location.lng)}`;
 }

 // Extract coordinates from common Google Maps URL formats.
 function parseGoogleMapsCoordinates(text) {
   const value = String(text || "").trim();
   if (!value) return null;

   const patterns = [
     /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
     /[?&](?:query|q|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
     /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/
   ];

   for (const pattern of patterns) {
     const match = value.match(pattern);
     if (!match) continue;

     const lat = Number(match[1]);
     const lng = Number(match[2]);

     if (
       Number.isFinite(lat) && Number.isFinite(lng) &&
       lat >= -90 && lat <= 90 &&
       lng >= -180 && lng <= 180
     ) {
       return { lat, lng };
     }
   }

   return null;
 }

 async function useGoogleMapsInstructionLocation() {
   const instructions = document.getElementById("instructions");
   const coords = parseGoogleMapsCoordinates(instructions ? instructions.value : "");

   if (!coords) return false;

   return setSelectedLocation(
     coords.lat,
     coords.lng,
     "Google Maps location shared in instructions",
     ""
   );
 }

// ---------------------------------------------------------------
// CHECKOUT / WHATSAPP
// ---------------------------------------------------------------

async function validateCheckout() {
   const name = document.getElementById("customerName").value.trim();
   const phone = document.getElementById("customerPhone").value.replace(/\D/g, "");
   const address = document.getElementById("deliveryAddress").value.trim();

   if (!name) return "Please enter your name.";
   if (!/^[6-9]\d{9}$/.test(phone)) return "Please enter a valid 10-digit Indian mobile number.";

   // If GPS was not shared, try to read coordinates from a Google Maps
   // link pasted into Delivery instructions.
   if (!selectedLocation || selectedLocation.deliveryCharge === null) {
     const usedInstructionLocation = await useGoogleMapsInstructionLocation();

     if (!usedInstructionLocation) {
       highlightLocationButton();

       const btn = document.getElementById("shareLocationBtn");
       if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });

       return "We need your delivery location. Tap “Share My Current Location”, or paste a Google Maps location link in Delivery instructions.";
     }
   }

   if (!address) return "Please enter the delivery address or landmark.";

   return "";
 }

 async function sendWhatsAppOrder() {
   const button = document.getElementById("whatsappBtn");
   if (button) {
     button.disabled = true;
     button.textContent = "Preparing order…";
   }

   try {
     const error = await validateCheckout();
     if (error) {
       toast(error);
       return;
     }

     const name = document.getElementById("customerName").value.trim();
     const phone = document.getElementById("customerPhone").value.replace(/\D/g, "");
     const address = document.getElementById("deliveryAddress").value.trim();
     const instructions = document.getElementById("instructions").value.trim();
     const delivery = selectedLocation.deliveryCharge || 0;
     const subtotal = cartSubtotal();
     const gst = subtotal * CONFIG.gstPercent / 100;
     const total = subtotal + gst + delivery;
     const mapsLink = googleMapsLinkForLocation(selectedLocation);

     const itemLines = cart.map((i, n) => {
       const p = products.find(x => x.id === i.productId);
       const line = lineTotal(p, i.qty, i.unit);
       return `${n + 1}. ${p.name}\n   ${formatNumber(i.qty)} ${i.unit} × ₹${money(p.price)}/${p.priceUnit} = ₹${money(line)}`;
     }).join("\n");

     const msg = `🥬 SEBA FRESH
━━━━━━━━━━━━━━━━━━━━━━━━

🧾 SALE ORDER

CUSTOMER DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━
👤 Name: ${name}
📱 Mobile: ${phone}

ORDER ITEMS
━━━━━━━━━━━━━━━━━━━━━━━━
${itemLines}

💰 BILL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal        : ₹${money(subtotal)}
GST (${CONFIG.gstPercent}%) : ₹${money(gst)}
Delivery        : ${delivery ? "₹"+money(delivery) : "FREE"}
────────────────────────
TOTAL           : ₹${money(total)}

📍 DELIVERY LOCATION
━━━━━━━━━━━━━━━━━━━━━━━━
${selectedLocation.address}
Distance        : Approximately ${formatNumber(selectedLocation.distanceKm)} km
Google Maps     : ${mapsLink}

🏠 DELIVERY ADDRESS
━━━━━━━━━━━━━━━━━━━━━━━━
${address}

${instructions ? `📝 DELIVERY INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━
${instructions}

` : ""}━━━━━━━━━━━━━━━━━━━━━━━━
Please confirm the sale order.

Thank you for choosing Seba Fresh 🥬
📱 WhatsApp: 6300614017`;

     window.open(`https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
   } finally {
     if (button) {
       button.disabled = false;
       button.textContent = "Send Sale Order on WhatsApp";
     }
   }
 }

function openInfoPage(page) {
  const pages = {
    privacy: ["Privacy Policy", `<p>Seba Fresh uses customer information only to process and deliver orders. Information entered on this website may include name, mobile number, delivery address, selected location and delivery instructions. The sale order is sent to Seba Fresh through WhatsApp when the customer chooses to submit it.</p><p>The product catalog is read from the published product sheet. Do not store private customer information in the public product sheet.</p>`],
    terms: ["Terms & Conditions", `<p>Product availability and prices are subject to confirmation by Seba Fresh. The website prepares a sale-order request; an order is considered confirmed only after Seba Fresh confirms it through WhatsApp or another agreed channel.</p><p>Displayed totals are calculated from the catalog available at the time of ordering. Final invoice details may be confirmed before delivery.</p>`],
    delivery: ["Delivery Information", `<p>Delivery is available within an approximate <b>10 km location radius</b> from the configured Seba Fresh location.</p><ul><li>Up to 5 km: free delivery.</li><li>More than 5 km and up to 10 km: ₹30 delivery charge.</li><li>More than 10 km: the website will not allow the sale order to be submitted.</li></ul><p>The website uses the customer's shared GPS coordinates and calculates an approximate straight-line distance. The WhatsApp order also includes a Google Maps link for delivery.</p>`],
    refund: ["Cancellation / Refund", `<p>Because this is a fresh-product ordering service, cancellation and refund decisions should be handled by Seba Fresh based on the status of the sale order and delivery. Contact <b>6300614017</b> for support.</p>`]
  };
  const [title, body] = pages[page] || ["Information", "<p>Information unavailable.</p>"];
  document.getElementById("modalContent").innerHTML = `<h2>${title}</h2>${body}`;
  document.getElementById("pageModal").classList.add("open");
}

/**
 * Called by the onerror attribute on product <img> tags.
 * Hides the broken image and shows the emoji fallback instead.
 */
function handleProductImageError(img, name) {
  img.style.display = "none";
  const emoji = img.nextElementSibling;
  if (emoji && emoji.classList.contains("emoji-img")) {
    emoji.style.display = "";
  }
}

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
