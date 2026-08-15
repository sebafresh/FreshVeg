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
  {
    id:"d-1", name:"Tomato", category:"Vegetables",
    price:35, mrp:50, hasDeal:true, offPct:30, priceUnit:"kg",
    quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250, maxQty:5000,
    images:[
      "https://images.unsplash.com/photo-1546470427-e26264be0b11?w=400&q=80",
      "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80",
      "https://images.unsplash.com/photo-1561136594-7f68413baa99?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Farm fresh red tomatoes"
  },
  {
    id:"d-2", name:"Potato", category:"Vegetables",
    price:28, mrp:40, hasDeal:true, offPct:30, priceUnit:"kg",
    quantityType:"weight", defaultQty:1, defaultUnit:"kg", step:1, minQty:1,
    images:[
      "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80",
      "https://images.unsplash.com/photo-1590165482129-1b8b27698780?w=400&q=80",
      "https://images.unsplash.com/photo-1508313880080-c4bef0730395?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Fresh potatoes"
  },
  {
    id:"d-3", name:"Onion", category:"Vegetables",
    price:35, mrp:0, hasDeal:false, offPct:0, priceUnit:"kg",
    quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250,
    images:[
      "https://images.unsplash.com/photo-1508747703725-719777637510?w=400&q=80",
      "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=400&q=80",
      "https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Red onions"
  },
  {
    id:"d-4", name:"Green Chilli", category:"Vegetables",
    price:60, mrp:100, hasDeal:true, offPct:40, priceUnit:"kg",
    quantityType:"weight", defaultQty:250, defaultUnit:"g", step:250, minQty:250, maxQty:500,
    images:[
      "https://images.unsplash.com/photo-1583119022894-919a68a3d0e3?w=400&q=80",
      "https://images.unsplash.com/photo-1601648764658-cf37e8c89b70?w=400&q=80",
      "https://images.unsplash.com/photo-1548247416-ec66f4900b2e?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Fresh green chillies"
  },
  {
    id:"d-5", name:"Spinach (Palak)", category:"Leafy",
    price:20, mrp:0, hasDeal:false, offPct:0, priceUnit:"kg",
    quantityType:"weight", defaultQty:250, defaultUnit:"g", step:250, minQty:250,
    images:[
      "https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&q=80",
      "https://images.unsplash.com/photo-1628773822503-930a7eaecf80?w=400&q=80",
      "https://images.unsplash.com/photo-1600326145552-327f74035060?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh spinach leaves"
  },
  {
    id:"d-6", name:"Cauliflower", category:"Vegetables",
    price:35, mrp:50, hasDeal:true, offPct:30, priceUnit:"pcs",
    quantityType:"pcs", defaultQty:1, defaultUnit:"pcs", step:1, minQty:1,
    images:[
      "https://images.unsplash.com/photo-1568584711075-3d021a7c3ca3?w=400&q=80",
      "https://images.unsplash.com/photo-1510627489930-0c1b0bfb6785?w=400&q=80",
      "https://images.unsplash.com/photo-1606788075761-c3e72c364b0e?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Farm fresh cauliflower — sold per piece"
  },
  {
    id:"d-7", name:"Carrot", category:"Vegetables",
    price:50, mrp:0, hasDeal:false, offPct:0, priceUnit:"kg",
    quantityType:"weight", defaultQty:500, defaultUnit:"g", step:250, minQty:250,
    images:[
      "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&q=80",
      "https://images.unsplash.com/photo-1582515073490-39981397c445?w=400&q=80",
      "https://images.unsplash.com/photo-1447175008436-054170c2e979?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Crunchy fresh carrots"
  },
  {
    id:"d-8", name:"Cucumber", category:"Vegetables",
    price:25, mrp:35, hasDeal:true, offPct:29, priceUnit:"pcs",
    quantityType:"pcs", defaultQty:2, defaultUnit:"pcs", step:1, minQty:1,
    images:[
      "https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=400&q=80",
      "https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=400&q=80",
      "https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh cucumbers — sold per piece"
  },
  {
    id:"d-9", name:"Cooking Oil", category:"Oils",
    price:160, mrp:200, hasDeal:true, offPct:20, priceUnit:"L",
    quantityType:"volume", defaultQty:1, defaultUnit:"L", step:1, minQty:1,
    images:[
      "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80",
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80",
      "https://images.unsplash.com/photo-1620706857370-e1b9770e8bb1?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Pure cooking oil"
  },
  {
    id:"d-10", name:"Lemon", category:"Fruits",
    price:5, mrp:8, hasDeal:true, offPct:38, priceUnit:"pcs",
    quantityType:"pcs", defaultQty:6, defaultUnit:"pcs", step:1, minQty:1,
    images:[
      "https://images.unsplash.com/photo-1590502593747-42a996133562?w=400&q=80",
      "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80",
      "https://images.unsplash.com/photo-1587486913049-53fc88980cfc?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:false, description:"Fresh lemons — sold per piece"
  },
  {
    id:"d-11", name:"Drumstick", category:"Vegetables",
    price:60, mrp:80, hasDeal:true, offPct:25, priceUnit:"kg",
    quantityType:"weight", defaultQty:250, defaultUnit:"g", step:250, minQty:250,
    images:[
      "https://images.unsplash.com/photo-1622542086073-dca4a5b9e01d?w=400&q=80",
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80",
      "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&q=80"
    ],
    defaultImage:CONFIG.defaultProductImage, available:true, featured:true, description:"Fresh drumsticks (Moringa)"
  }
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
  // quantity_type: "weight" | "volume" | "pcs"
  const rawType = (r.quantity_type || r.unittype || r.type || "weight").toLowerCase();
  const quantityType = rawType === "pcs" || rawType === "piece" || rawType === "pieces" ? "pcs"
                     : rawType === "volume" ? "volume" : "weight";

  const defaultUnit = r.default_unit || r.quantity_unit || r.unit
    || (quantityType === "volume" ? CONFIG.globalVolume.unit
      : quantityType === "pcs"   ? "pcs"
      : CONFIG.globalWeight.unit);

  const priceUnit = r.price_unit || r.pricing_unit
    || (quantityType === "volume" ? "L"
      : quantityType === "pcs"   ? "pcs"
      : "kg");

  const defaultQty = Number(r.default_qty || r.default_quantity || 0);
  const step       = Number(r.step_qty    || r.quantity_step    || 0);

  // Discount / MRP support.
  // Sheet columns accepted:  mrp | actual_price | original_price
  //                          price | discounted_price | sale_price
  // Rule: if both mrp and price are present, price = sale price, mrp = crossed-out price.
  //       if only price is present, no discount badge is shown.
  const salePrice = Number(r.price || r.discounted_price || r.sale_price || 0);
  const mrp       = Number(r.mrp   || r.actual_price    || r.original_price || 0);
  // Only treat mrp as a real MRP if it is strictly greater than the sale price.
  const hasDeal   = mrp > salePrice && salePrice > 0;
  const offPct    = hasDeal ? Math.round((1 - salePrice / mrp) * 100) : 0;

  return {
    id: r.id || cryptoRandomId(),
    name: r.name || r.product || "",
    category: r.category || "Other",
    price:    salePrice,
    mrp:      hasDeal ? mrp : 0,
    offPct,
    hasDeal,
    priceUnit,
    quantityType,
    defaultQty: defaultQty > 0 ? defaultQty : null,
    defaultUnit: normalizeUnit(defaultUnit),
    step:   step > 0 ? step : null,
    minQty: Number(r.min_qty || r.min_quantity || 0) || null,
    // max_qty is in the same unit as default_unit (Option A).
    // Blank / 0 means unlimited stock — no cap applied.
    maxQty: Number(r.max_qty || r.max_quantity || r.stock || 0) || null,
    images: [r.image1 || r.image || r.image_url || "", r.image2 || "", r.image3 || ""].filter(Boolean),
    defaultImage: CONFIG.defaultProductImage,
    available: !["no","false","0","out of stock"].includes((r.available || "yes").toLowerCase()),
    featured:  ["yes","true","1","latest","featured"].includes((r.featured || r.latest || "").toLowerCase()),
    description: r.description || ""
  };
}

function normalizeUnit(u) {
  const x = String(u).trim().toLowerCase();
  if (x === "kg" || x === "kilogram" || x === "kilograms") return "kg";
  if (x === "g"  || x === "gram"     || x === "grams")     return "g";
  if (x === "l"  || x === "litre"    || x === "liter" || x === "liters" || x === "litres") return "L";
  if (x === "ml" || x === "millilitre" || x === "milliliter") return "ml";
  if (x === "pcs" || x === "piece" || x === "pieces" || x === "pc") return "pcs";
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
  stopAllSliderTimers();
  document.getElementById("productGrid").innerHTML = filtered.length
    ? filtered.map(productCard).join("")
    : `<div class="empty">No products found.</div>`;
  bindProductCards();
  startSliderTimers();
}

function renderLatest() {
  const list = products.filter(p => p.featured).slice(0, 8);
  stopAllSliderTimers();
  document.getElementById("latestGrid").innerHTML = list.length
    ? list.map(productCard).join("")
    : `<div class="empty">Mark products as <b>featured=yes</b> in Google Sheets to show them here.</div>`;
  bindProductCards();
  startSliderTimers();
}

// ---------------------------------------------------------------
// QUANTITY / UNIT RULES
// ---------------------------------------------------------------

// pcs has a factor of 1 (price per piece = price per 1 pcs)
const UNIT_FACTOR = { g: 1, kg: 1000, ml: 1, L: 1000, pcs: 1 };

function toBaseQty(qty, unit) { return qty * (UNIT_FACTOR[unit] || 1); }

/**
 * Step size for +/-.
 *  - pcs        → always 1 piece
 *  - kg / L     → always 1
 *  - g / ml     → product's step_qty or DEFAULT_BASE_STEP
 */
function stepFor(p, unit) {
  if (unit === "pcs") return 1;
  if (unit === "kg" || unit === "L") return 1;
  return p.step || CONFIG.DEFAULT_BASE_STEP;
}

function minFor(p, unit) {
  if (unit === "pcs") return 1;
  if (unit === "kg" || unit === "L") return 1;
  return p.minQty || p.step || CONFIG.DEFAULT_BASE_MIN;
}

/**
 * Maximum orderable quantity in the requested unit.
 * maxQty is stored in default_unit (Option A).
 * Returns null when no cap is set (unlimited).
 */
function maxFor(p, unit) {
  if (!p.maxQty) return null;                        // unlimited
  const defaultUnit = p.defaultUnit || "g";
  if (unit === defaultUnit) return p.maxQty;         // same unit — direct

  // Convert: both weight or both volume
  const fromBase = UNIT_FACTOR[defaultUnit] || 1;
  const toBase   = UNIT_FACTOR[unit]        || 1;
  return Math.round((p.maxQty * fromBase / toBase) * 1000) / 1000;
}

/** Human-readable stock label in the most natural unit. */
function stockLabel(p) {
  if (!p.maxQty) return "";
  const u   = p.defaultUnit || "g";
  const qty = p.maxQty;
  // For weight: show in kg if ≥ 1000g
  if ((u === "g") && qty >= 1000) return `${formatNumber(qty / 1000)} kg`;
  // For ml: show in L if ≥ 1000ml
  if ((u === "ml") && qty >= 1000) return `${formatNumber(qty / 1000)} L`;
  return `${formatNumber(qty)} ${u}`;
}

function getDefaultQuantity(p) {
  if (p.defaultQty && p.defaultUnit) return { qty: p.defaultQty, unit: p.defaultUnit };
  if (p.quantityType === "pcs")    return { qty: 1, unit: "pcs" };
  if (p.quantityType === "volume") return CONFIG.globalVolume;
  return CONFIG.globalWeight;
}

/** Price for a given qty+unit against a product's per-price_unit price. */
function lineTotal(p, qty, unit) {
  if (unit === "pcs") return Math.round(qty * p.price * 100) / 100;
  const base = toBaseQty(qty, unit);
  const priceUnitBase = UNIT_FACTOR[normalizeUnit(p.priceUnit)] || 1;
  const raw = (base / priceUnitBase) * p.price;
  return Math.round(raw * 100) / 100;
}

function cartItemFor(productId) { return cart.find(i => i.productId === productId) || null; }

// ---------------------------------------------------------------
// PRODUCT CARD
// ---------------------------------------------------------------

/**
 * For weight products priced per kg, return an attractive small-pack price.
 * e.g. ₹50/kg → "₹12.50 for 250 g"
 * Returns empty string for pcs / volume products.
 */
function attractiveUnitPrice(p) {
  if (p.quantityType !== "weight") return "";
  const pricePerKg = (normalizeUnit(p.priceUnit) === "kg") ? p.price
                   : (normalizeUnit(p.priceUnit) === "g")  ? p.price * 1000
                   : 0;
  if (!pricePerKg) return "";
  const displayG   = (p.step && p.step < 1000) ? p.step : 250;
  const priceForQty = Math.round((displayG / 1000) * pricePerKg * 100) / 100;
  return `<div class="price-per-g">Just ₹${money(priceForQty)} for ${displayG} g</div>`;
}

/**
 * Smart quantity stepper — replaces the old quick-pick buttons and dropdown.
 *
 * Shows:  [−]  [number input]  [unit toggle g|kg]  [+]
 *         Min 250 g • steps of 250 g
 *
 * - Customer can type any value freely (e.g. 350 g)
 * - −/+ step by step_qty from the sheet
 * - Unit toggle (g ↔ kg or ml ↔ L) resets qty to min for that unit
 * - pcs products just show the input with no unit toggle
 */
function qtyStepperWidget(p, selQty, selUnit) {
  const step = stepFor(p, selUnit);
  const min  = minFor(p, selUnit);
  const max  = maxFor(p, selUnit);   // null = unlimited

  // Unit toggle buttons (only for weight/volume)
  let unitToggle = "";
  if (p.quantityType === "weight") {
    unitToggle = `<div class="unit-toggle">
      <button type="button" class="utog${selUnit === "g"  ? " active" : ""}" data-utog="${escapeAttr(p.id)}" data-utog-unit="g">g</button>
      <button type="button" class="utog${selUnit === "kg" ? " active" : ""}" data-utog="${escapeAttr(p.id)}" data-utog-unit="kg">kg</button>
    </div>`;
  } else if (p.quantityType === "volume") {
    unitToggle = `<div class="unit-toggle">
      <button type="button" class="utog${selUnit === "ml" ? " active" : ""}" data-utog="${escapeAttr(p.id)}" data-utog-unit="ml">ml</button>
      <button type="button" class="utog${selUnit === "L"  ? " active" : ""}" data-utog="${escapeAttr(p.id)}" data-utog-unit="L">L</button>
    </div>`;
  }

  const unitLabel = p.quantityType === "pcs" ? "pcs" : selUnit;

  // Stock hint line — orange warning when limited, nothing when unlimited
  const label = stockLabel(p);
  const stockHint = label
    ? `<div class="stock-hint ${p.maxQty <= (p.step || 500) ? "stock-low" : ""}">
         🛒 Only ${label} available today
       </div>`
    : "";

  // Hint line (min / step)
  const hint = `<div class="qty-hint">Min ${min} ${unitLabel} • steps of ${step} ${unitLabel}${max ? ` • max ${formatNumber(max)} ${unitLabel}` : ""}</div>`;

  return `<div class="qty-stepper" data-stepper="${escapeAttr(p.id)}">
    <button type="button" class="qs-btn" data-qs-dec="${escapeAttr(p.id)}" aria-label="Decrease">−</button>
    <input  class="qs-input"
            type="number"
            min="${min}"
            step="${step}"
            ${max !== null ? `max="${max}"` : ""}
            value="${Math.min(selQty, max ?? selQty)}"
            data-qty-field="${escapeAttr(p.id)}"
            aria-label="Quantity">
    ${unitToggle || `<span class="qs-unit-label">pcs</span>`}
    <button type="button" class="qs-btn" data-qs-inc="${escapeAttr(p.id)}" aria-label="Increase">+</button>
  </div>
  ${stockHint}
  ${hint}
  <input type="hidden" data-unit-pre="${escapeAttr(p.id)}" value="${escapeAttr(selUnit)}">`;
}

/** Build the image area — single img or a 3-slide carousel. */
function productImageBlock(p) {
  const imgs = p.images && p.images.length ? p.images : (p.defaultImage ? [p.defaultImage] : []);
  if (!imgs.length) return `<span class="emoji-img">${vegetableEmoji(p.name)}</span>`;

  if (imgs.length === 1) {
    return `<img loading="lazy" src="${escapeAttr(imgs[0])}" alt="${escapeAttr(p.name)}"
              onerror="handleProductImageError(this,'${escapeAttr(p.name)}')">
            <span class="emoji-img" style="display:none">${vegetableEmoji(p.name)}</span>`;
  }

  const slides = imgs.map((src, i) => `
    <div class="slide${i === 0 ? " active" : ""}">
      <img loading="lazy" src="${escapeAttr(src)}" alt="${escapeAttr(p.name)} ${i + 1}"
           onerror="handleProductImageError(this,'${escapeAttr(p.name)}')">
      <span class="emoji-img" style="display:none">${vegetableEmoji(p.name)}</span>
    </div>`).join("");

  const dots = imgs.map((_, i) =>
    `<button class="slide-dot${i === 0 ? " active" : ""}" data-slide-dot="${i}" aria-label="Image ${i + 1}"></button>`
  ).join("");

  return `
    <div class="slider" data-slider="${escapeAttr(p.id)}">
      <div class="slides">${slides}</div>
      <button class="slide-arrow slide-prev" data-slider-prev="${escapeAttr(p.id)}" aria-label="Previous image">‹</button>
      <button class="slide-arrow slide-next" data-slider-next="${escapeAttr(p.id)}" aria-label="Next image">›</button>
      <div class="slide-dots">${dots}</div>
    </div>`;
}

function productCard(p) {
  const inCart   = cartItemFor(p.id);
  const defaults = getDefaultQuantity(p);
  const img      = productImageBlock(p);

  // Attractive small-pack price line (weight products only)
  const subPrice = attractiveUnitPrice(p);

  // Price block
  const priceBlock = p.hasDeal
    ? `<div class="price-row">
         <span class="badge-off">${p.offPct}% OFF</span>
         <span class="price-sale">₹${money(p.price)}</span>
         <span class="price-mrp">₹${money(p.mrp)}</span>
         <small class="price-unit">/ ${escapeHTML(p.priceUnit)}</small>
       </div>
       ${subPrice}
       <div class="price-saving">Save ₹${money(p.mrp - p.price)} per ${escapeHTML(p.priceUnit)}</div>`
    : `<div class="price-row">
         <span class="price-sale">₹${money(p.price)}</span>
         <small class="price-unit">/ ${escapeHTML(p.priceUnit)}</small>
       </div>
       ${subPrice}`;

  let qtyBlock;
  if (p.maxQty === 0) {
    // Explicitly set to 0 → out of stock today
    qtyBlock = `<div class="out-of-stock-badge">⊘ Out of stock today</div>`;
  } else if (inCart) {
    // In-cart stepper — keeps the unit label, no dropdown
    qtyBlock = `
      <div class="in-cart-row">
        <span class="in-cart-badge">✓ In cart — ₹${money(lineTotal(p, inCart.qty, inCart.unit))}</span>
        <button class="remove-link" data-remove="${escapeAttr(p.id)}">Remove</button>
      </div>
      <div class="stepper">
        <button type="button" data-dec="${escapeAttr(p.id)}" aria-label="Decrease">−</button>
        <span class="qty-val">${formatNumber(inCart.qty)} ${escapeHTML(inCart.unit)}</span>
        <button type="button" data-inc="${escapeAttr(p.id)}" aria-label="Increase">+</button>
      </div>`;
  } else {
    // Not in cart — smart stepper widget
    qtyBlock = `
      ${qtyStepperWidget(p, defaults.qty, defaults.unit)}
      <button class="add" data-add="${escapeAttr(p.id)}">Add to cart</button>`;
  }

  return `<article class="product" data-product="${escapeAttr(p.id)}">
    <div class="product-img">${img}</div>
    <div class="product-body">
      <div class="product-category">${escapeHTML(p.category)}</div>
      <h3>${escapeHTML(p.name)}</h3>
      <div class="product-desc">${escapeHTML(p.description)}</div>
      ${priceBlock}
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

// ---------------------------------------------------------------
// SLIDER STATE & LOGIC
// ---------------------------------------------------------------
// One entry per product id: { index, timer }
const sliderState = {};

/**
 * Move a slider to a specific slide index.
 * Updates .active on both .slide elements and .slide-dot buttons.
 */
function sliderGoTo(productId, index) {
  const el = document.querySelector(`[data-slider="${CSS.escape(productId)}"]`);
  if (!el) return;
  const slides = el.querySelectorAll(".slide");
  const dots   = el.querySelectorAll(".slide-dot");
  const count  = slides.length;
  if (!count) return;

  // Wrap around
  const next = ((index % count) + count) % count;

  slides.forEach((s, i) => s.classList.toggle("active", i === next));
  dots.forEach((d, i)   => d.classList.toggle("active", i === next));

  if (sliderState[productId]) sliderState[productId].index = next;
}

/** Start auto-advance timers for every slider currently in the DOM. */
function startSliderTimers() {
  document.querySelectorAll("[data-slider]").forEach(el => {
    const pid = el.dataset.slider;
    const count = el.querySelectorAll(".slide").length;
    if (count < 2) return;

    // Clear any existing timer so re-renders don't stack timers
    stopSliderTimer(pid);

    if (!sliderState[pid]) sliderState[pid] = { index: 0 };

    sliderState[pid].timer = setInterval(() => {
      sliderGoTo(pid, (sliderState[pid].index + 1));
    }, 3000); // advance every 3 seconds
  });
}

function stopSliderTimer(productId) {
  if (sliderState[productId]?.timer) {
    clearInterval(sliderState[productId].timer);
    sliderState[productId].timer = null;
  }
}

/** Stop ALL running slider timers (called before a full re-render). */
function stopAllSliderTimers() {
  Object.keys(sliderState).forEach(stopSliderTimer);
}

function bindProductEvents() {
  // Delegate from both grids and the cart drawer to catch all cards.
  ["productGrid", "latestGrid", "cartItems"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("click", e => {
      const t = e.target;

      // Slider: prev / next arrows
      const prevId = t.closest("[data-slider-prev]")?.dataset.sliderPrev;
      if (prevId) {
        const cur = sliderState[prevId]?.index ?? 0;
        sliderGoTo(prevId, cur - 1);
        // Reset the auto-advance timer so it doesn't jump immediately after manual nav
        stopSliderTimer(prevId);
        if (sliderState[prevId]) {
          const count = document.querySelector(`[data-slider="${CSS.escape(prevId)}"]`)?.querySelectorAll(".slide").length ?? 0;
          if (count > 1) sliderState[prevId].timer = setInterval(() => sliderGoTo(prevId, (sliderState[prevId].index + 1)), 3000);
        }
        return;
      }
      const nextId = t.closest("[data-slider-next]")?.dataset.sliderNext;
      if (nextId) {
        const cur = sliderState[nextId]?.index ?? 0;
        sliderGoTo(nextId, cur + 1);
        stopSliderTimer(nextId);
        if (sliderState[nextId]) {
          const count = document.querySelector(`[data-slider="${CSS.escape(nextId)}"]`)?.querySelectorAll(".slide").length ?? 0;
          if (count > 1) sliderState[nextId].timer = setInterval(() => sliderGoTo(nextId, (sliderState[nextId].index + 1)), 3000);
        }
        return;
      }

      // Slider: dot buttons
      const dotBtn = t.closest("[data-slide-dot]");
      if (dotBtn) {
        const slider = dotBtn.closest("[data-slider]");
        if (slider) {
          const pid = slider.dataset.slider;
          sliderGoTo(pid, Number(dotBtn.dataset.slideDot));
          stopSliderTimer(pid);
          if (sliderState[pid]) {
            const count = slider.querySelectorAll(".slide").length;
            if (count > 1) sliderState[pid].timer = setInterval(() => sliderGoTo(pid, (sliderState[pid].index + 1)), 3000);
          }
        }
        return;
      }

      // Smart qty stepper: − button
      const qsDecId = t.closest("[data-qs-dec]")?.dataset.qsDec;
      if (qsDecId) {
        const stepper = t.closest("[data-stepper]") || document.querySelector(`[data-stepper="${CSS.escape(qsDecId)}"]`);
        if (stepper) {
          const input = stepper.querySelector(`[data-qty-field="${CSS.escape(qsDecId)}"]`);
          const unitEl = t.closest(".product")?.querySelector(`[data-unit-pre="${CSS.escape(qsDecId)}"]`);
          const p = products.find(x => x.id === qsDecId);
          if (input && p) {
            const unit = unitEl ? unitEl.value : (p.quantityType === "pcs" ? "pcs" : "g");
            const step = stepFor(p, unit);
            const min  = minFor(p, unit);
            const newVal = Math.max(min, Number(input.value) - step);
            input.value = Math.round(newVal * 1000) / 1000;
          }
        }
        return;
      }

      // Smart qty stepper: + button
      const qsIncId = t.closest("[data-qs-inc]")?.dataset.qsInc;
      if (qsIncId) {
        const stepper = t.closest("[data-stepper]") || document.querySelector(`[data-stepper="${CSS.escape(qsIncId)}"]`);
        if (stepper) {
          const input  = stepper.querySelector(`[data-qty-field="${CSS.escape(qsIncId)}"]`);
          const unitEl = t.closest(".product")?.querySelector(`[data-unit-pre="${CSS.escape(qsIncId)}"]`);
          const p      = products.find(x => x.id === qsIncId);
          if (input && p) {
            const unit   = unitEl ? unitEl.value : (p.quantityType === "pcs" ? "pcs" : "g");
            const step   = stepFor(p, unit);
            const max    = maxFor(p, unit);
            const newVal = Math.round((Number(input.value) + step) * 1000) / 1000;
            if (max !== null && newVal > max) {
              toast(`Only ${formatNumber(max)} ${unit} available today`);
              input.value = max;
            } else {
              input.value = newVal;
            }
          }
        }
        return;
      }

      // Unit toggle (g ↔ kg, ml ↔ L)
      const utogBtn = t.closest("[data-utog]");
      if (utogBtn) {
        const pid     = utogBtn.dataset.utog;
        const newUnit = utogBtn.dataset.utogUnit;
        const card    = t.closest(".product");
        if (card) {
          // Update hidden unit field
          const unitHidden = card.querySelector(`[data-unit-pre="${CSS.escape(pid)}"]`);
          if (unitHidden) unitHidden.value = newUnit;

          // Update active state on toggle buttons
          card.querySelectorAll(`[data-utog="${CSS.escape(pid)}"]`).forEach(b => {
            b.classList.toggle("active", b.dataset.utogUnit === newUnit);
          });

          // Reset qty input to min for the new unit
          const p     = products.find(x => x.id === pid);
          const input = card.querySelector(`[data-qty-field="${CSS.escape(pid)}"]`);
          if (p && input) {
            const min  = minFor(p, newUnit);
            const max  = maxFor(p, newUnit);
            const step = stepFor(p, newUnit);
            input.min   = min;
            input.step  = step;
            if (max !== null) input.max = max; else input.removeAttribute("max");
            input.value = Math.min(min, max ?? min);
            // Update hint text
            const hint = card.querySelector(".qty-hint");
            if (hint) hint.textContent = `Min ${min} ${newUnit} • steps of ${step} ${newUnit}${max ? ` • max ${formatNumber(max)} ${newUnit}` : ""}`;
            // Update stock hint
            const stockHint = card.querySelector(".stock-hint");
            if (stockHint) {
              const label = stockLabel(p);
              stockHint.textContent = label ? `🛒 Only ${label} available today` : "";
              stockHint.style.display = label ? "" : "none";
            }
          }
        }
        return;
      }

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
  const max = maxFor(p, unit);

  if (!qty || qty < min) return toast(`Minimum quantity is ${min} ${unit}`);
  if (max !== null && qty > max) {
    toast(`Only ${formatNumber(max)} ${unit} available. Quantity adjusted.`);
    qty = max;
  }

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

/** +/- respects the CURRENT unit's own step/min/max (see stepFor/minFor/maxFor). */
function changeQty(productId, direction) {
  const item = cartItemFor(productId);
  if (!item) return;
  const p    = products.find(x => x.id === productId);
  const step = stepFor(p, item.unit);
  const min  = minFor(p, item.unit);
  const max  = maxFor(p, item.unit);
  const newQty = direction > 0 ? item.qty + step : item.qty - step;

  if (newQty < min) { removeFromCart(productId); return; }
  if (max !== null && newQty > max) {
    toast(`Only ${formatNumber(max)} ${item.unit} available`);
    return;
  }
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
  updateLocationUI();

  // Set delivery date default to today and block past dates
  const dateEl = document.getElementById("deliveryDate");
  if (dateEl) {
    const today = new Date().toISOString().split("T")[0];
    dateEl.min   = today;
    if (!dateEl.value) dateEl.value = today;
    // Show/hide price disclaimer whenever the date changes
    dateEl.addEventListener("change", updatePriceDisclaimer, { once: false });
  }
  updatePriceDisclaimer();

  const drawerBody = document.querySelector(".drawer-body");
  const form = document.getElementById("checkoutForm");
  requestAnimationFrame(() => {
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    if (drawerBody) drawerBody.scrollTo({ top: form.offsetTop - 12, behavior: "smooth" });
    highlightCheckoutFields();
  });
}

/**
 * Shows a red disclaimer banner when the selected delivery date is in the
 * future (i.e. advance order). Hidden for same-day orders.
 */
function updatePriceDisclaimer() {
  const dateEl = document.getElementById("deliveryDate");
  let banner   = document.getElementById("priceDisclaimerBanner");

  // Create the banner element once if it doesn't exist yet
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "priceDisclaimerBanner";
    banner.className = "price-disclaimer";
    banner.innerHTML = `⚠️ <b>Price note:</b> This is an advance order. Final prices will be confirmed at delivery based on current market rates. <b>Price variation may apply.</b>`;
    // Insert it right before the WhatsApp button
    const waBtn = document.getElementById("whatsappBtn");
    if (waBtn) waBtn.parentNode.insertBefore(banner, waBtn);
  }

  if (!dateEl) { banner.style.display = "none"; return; }
  const today    = new Date().toISOString().split("T")[0];
  const isFuture = dateEl.value > today;
  banner.style.display = isFuture ? "block" : "none";
}

/** Briefly pulse all empty required checkout fields so they stand out. */
function highlightCheckoutFields() {
  const fields = [
    document.getElementById("customerName"),
    document.getElementById("customerPhone"),
    document.getElementById("deliveryDate"),
    document.getElementById("deliveryAddress")
  ];
  fields.forEach(el => {
    if (!el || el.value.trim()) return;   // skip already-filled fields
    el.classList.remove("field-highlight");
    void el.offsetWidth;                  // force reflow to restart animation
    el.classList.add("field-highlight");
    el.addEventListener("input", () => el.classList.remove("field-highlight"), { once: true });
  });
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
   const name  = document.getElementById("customerName").value.trim();
   const phone = document.getElementById("customerPhone").value.replace(/\D/g, "");
   const dateEl = document.getElementById("deliveryDate");
   const deliveryDate = dateEl ? dateEl.value : "";
   const address = document.getElementById("deliveryAddress").value.trim();

   if (!name)  return "Please enter your name.";
   if (!/^[6-9]\d{9}$/.test(phone)) return "Please enter a valid 10-digit Indian mobile number.";
   if (!deliveryDate) return "Please select a preferred delivery date.";

   const today = new Date().toISOString().split("T")[0];
   if (deliveryDate < today) return "Delivery date cannot be in the past.";

   // If GPS was not shared, try to read coordinates from a Google Maps link
   if (!selectedLocation || selectedLocation.deliveryCharge === null) {
     const usedInstructionLocation = await useGoogleMapsInstructionLocation();
     if (!usedInstructionLocation) {
       highlightLocationButton();
       const btn = document.getElementById("shareLocationBtn");
       if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
       return "We need your delivery location. Tap \u201cShare My Current Location\u201d, or paste a Google Maps location link in Delivery instructions.";
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
      const deliveryDate = (document.getElementById("deliveryDate") || {}).value || "";
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
📅 Delivery Date: ${deliveryDate}

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
${deliveryDate > new Date().toISOString().split("T")[0]
  ? `\n⚠️ PRICE NOTE: This order is placed in advance. Final prices will be confirmed at the time of delivery based on current market rates. Price variation may apply.\n`
  : ""}
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
    refund: ["Cancellation / Refund", `<p>Because this is a fresh-product ordering service, cancellation and refund decisions should be handled by Seba Fresh based on the status of the sale order and delivery. Contact <b><a href="tel:+916300614017">📞 6300614017</a></b> or <a href="https://wa.me/916300614017" target="_blank" rel="noopener">💬 WhatsApp</a> for support.</p>`]
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
  if (n.includes("drumstick") || n.includes("moringa") || n.includes("murungai")) return "🌿";
  if (n.includes("cauliflower")) return "🥦";
  if (n.includes("spinach") || n.includes("palak")) return "🥬";
  if (n.includes("pumpkin") || n.includes("gourd")) return "🎃";
  if (n.includes("beetroot") || n.includes("beet")) return "🫛";
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
