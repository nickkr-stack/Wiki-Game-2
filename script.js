// =====================
// CONFIG (Google Sheets CSV)
// =====================
const STOPWORDS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vResCHMBJc_xFz9mR1AhFyMaeGQvdT4KKMu4QkQTJ2S3nJF6GkSAxyZeE7i7n7gYvdnRibjSW2-Xno2/pub?gid=0&single=true&output=csv";

const ARTICLES_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vResCHMBJc_xFz9mR1AhFyMaeGQvdT4KKMu4QkQTJ2S3nJF6GkSAxyZeE7i7n7gYvdnRibjSW2-Xno2/pub?gid=1078052796&single=true&output=csv";

// =====================
// DOM
// =====================
const startScreen = document.getElementById("startScreen");
const gameScreen = document.getElementById("gameScreen");
const newGameBtn = document.getElementById("newGameBtn");     // стартовый экран
const newGameBtn2 = document.getElementById("newGameBtn2");   // после открытия
const openBtn = document.getElementById("openBtn");           // кнопка "Открыть" (внизу рядом с таблицей)
const articleView = document.getElementById("articleView");
const guessInput = document.getElementById("guessInput");
const lastInfo = document.getElementById("lastInfo");
const checkedTable = document.getElementById("checkedTable");

// =====================
// STATE
// =====================
let STOP_WORDS = new Set();
let ARTICLES = [];

let checkedWords = [];      // { word, count, t, key }
let checkedKeySet = new Set();
let tCounter = 0;

// =====================
// CSV parsing
// =====================
function parseCsvLinesToList(csvText) {
  const text = (csvText || "").replace(/^\uFEFF/, "");
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      // remove surrounding quotes if present
      if (line.startsWith('"') && line.endsWith('"')) line = line.slice(1, -1);
      return line.trim();
    })
    .filter(Boolean);
}

// =====================
// Load stopwords (fresh each time, fallback to cache)
// =====================
async function loadStopWords() {
  // cache
  let cachedList = null;
  try {
    const cached = localStorage.getItem("wikigame_stopwords_v2");
    if (cached) {
      const arr = JSON.parse(cached);
      if (Array.isArray(arr) && arr.length > 0) cachedList = arr;
    }
  } catch (_) {}

  try {
    const url = STOPWORDS_CSV_URL + "&cb=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();
    const list = parseCsvLinesToList(csv).map(s => normalizeForCompare(s));

    STOP_WORDS = new Set(list);

    try { localStorage.setItem("wikigame_stopwords_v2", JSON.stringify(list)); } catch (_) {}
    return;
  } catch (e) {
    if (cachedList) {
      STOP_WORDS = new Set(cachedList);
      console.warn("Stopwords: using cached list (fetch failed):", e);
      return;
    }
    STOP_WORDS = new Set(["и","в","на","не","что","это","а","но","как","к","по","из","за","для","от","до","о","у","с"]);
    console.warn("Stopwords: using fallback:", e);
  }
}

// =====================
// Load articles (fresh each time, fallback to cache)
// =====================
async function loadArticles() {
  let cachedList = null;
  try {
    const cached = localStorage.getItem("wikigame_articles_v1");
    if (cached) {
      const arr = JSON.parse(cached);
      if (Array.isArray(arr) && arr.length > 0) cachedList = arr;
    }
  } catch (_) {}

  try {
    const url = ARTICLES_CSV_URL + "&cb=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const csv = await res.text();

    const list = parseCsvLinesToList(csv)
      .map(s => s.trim())
      .filter(Boolean);

    const cleaned = list.filter(u => /^https:\/\/ru\.wikipedia\.org\/wiki\//i.test(u));
    if (cleaned.length === 0) throw new Error("Articles list is empty/invalid");

    ARTICLES = cleaned;
    try { localStorage.setItem("wikigame_articles_v1", JSON.stringify(cleaned)); } catch (_) {}
    return;
  } catch (e) {
    if (cachedList && cachedList.length) {
      ARTICLES = cachedList;
      console.warn("Articles: using cached list (fetch failed):", e);
      return;
    }
    ARTICLES = ["https://ru.wikipedia.org/wiki/Шахматы"];
    console.warn("Articles: using fallback:", e);
  }
}

function pickRandomArticleUrl() {
  if (!ARTICLES || ARTICLES.length === 0) return "https://ru.wikipedia.org/wiki/Шахматы";
  return ARTICLES[Math.floor(Math.random() * ARTICLES.length)];
}

// =====================
// Wiki API
// =====================
function titleFromWikiUrl(url) {
  const m = String(url).match(/\/wiki\/([^#?]+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/_/g, " ");
}

async function fetchArticleHtmlByTitle(title) {
  const api =
    "https://ru.wikipedia.org/w/api.php" +
    "?action=parse" +
    "&prop=text" +
    "&format=json" +
    "&redirects=1" +
    "&page=" + encodeURIComponent(title) +
    "&origin=*";

  const res = await fetch(api);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const html = data?.parse?.text?.["*"];
  if (!html) throw new Error("No HTML returned");
  return html;
}

function cleanWikipediaHtml(rawHtml) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = rawHtml;

  const root = wrapper.querySelector(".mw-parser-output") || wrapper;

  const removeSelectors = [
    "table", "img", "figure", "figcaption",
    ".infobox", ".navbox", ".vertical-navbox", ".metadata",
    ".mw-editsection", ".hatnote", ".ambox",
    "sup.reference", ".reflist", "ol.references",
    ".mw-references-wrap", "#toc", ".toc",
    ".thumb", ".gallery", ".portal",
    ".catlinks", ".mw-authority-control",
    ".shortdescription", ".sistersitebox",
    "style", "script"
  ];
  for (const sel of removeSelectors) root.querySelectorAll(sel).forEach(el => el.remove());

  root.querySelectorAll("a").forEach(a => {
    a.replaceWith(document.createTextNode(a.textContent || ""));
  });

  const blocks = root.querySelectorAll("h2,h3,h4,p,ul,ol,blockquote");
  const htmlParts = [];

  blocks.forEach(el => {
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!txt) return;
    if ((el.tagName === "UL" || el.tagName === "OL") && !el.querySelector("li")) return;

    const clone = el.cloneNode(true);
    clone.removeAttribute("style");
    clone.removeAttribute("class");
    clone.removeAttribute("id");
    clone.querySelectorAll("*").forEach(n => {
      n.removeAttribute("style");
      n.removeAttribute("class");
      n.removeAttribute("id");
    });

    htmlParts.push(clone.outerHTML);
  });

  return htmlParts.join("\n") || "<p>Не удалось извлечь содержательный текст.</p>";
}

// =====================
// Tokenization / masking
// =====================

let __markPropsOk = null;

function stripStressMarks(s) {
  // Удаляем ТОЛЬКО знаки ударения, не трогая диакритику букв (й/ё и т.п.)
  // В русской Википедии чаще всего встречается combining acute U+0301.
  // Иногда — grave U+0300, иногда — отдельный символ ´ (U+00B4) или U+02CA.
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0301\u0300\u0341\u00B4\u02CA]/g, "")
    .normalize("NFC");
}

function normalizeForCompare(s) {
  return stripStressMarks(s)
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}


let __unicodePropsOk = null;
function isLetterOrDigit(ch) {
  if (__unicodePropsOk === null) {
    try { new RegExp("\\p{L}", "u"); __unicodePropsOk = true; }
    catch (e) { __unicodePropsOk = false; }
  }
  if (__unicodePropsOk) return /[\p{L}\p{N}]/u.test(ch);

  const isDigit = ch >= "0" && ch <= "9";
  const isLetter = ch.toLowerCase() !== ch.toUpperCase();
  return isLetter || isDigit;
}

function maskForToken(token) {
  let out = "";
  for (const ch of token) out += isLetterOrDigit(ch) ? "□" : ch;
  return out;
}

function tokenizeTextKeepPunct(text) {
  const parts = [];
  let buf = "";
  const flush = () => { if (buf) { parts.push(buf); buf = ""; } };

  for (const ch of text) {
    if (isLetterOrDigit(ch)) buf += ch;
    else { flush(); parts.push(ch); }
  }
  flush();
  return parts;
}

function keyForGuess(guessLower) {
  return guessLower.length < 5 ? guessLower : guessLower.slice(0, 5);
}

function buildGameDomFromCleanHtml(cleanHtml) {
  const container = document.createElement("div");
  container.innerHTML = cleanHtml;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeValue == null) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
const parts = tokenizeTextKeepPunct(stripStressMarks(node.nodeValue));

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;

      const isWord = [...part].every(isLetterOrDigit);

      if (isWord) {
        const original = part;
const lower = normalizeForCompare(original);

        const span = document.createElement("span");
        span.className = "word";
        span.dataset.orig = original;
        span.dataset.w = lower;
        span.dataset.key = keyForGuess(lower);
        span.dataset.mask = maskForToken(original);

        // default: masked
        span.textContent = span.dataset.mask;

        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }

    node.parentNode.replaceChild(frag, node);
  }

  return container;
}

function revealStopWords(container) {
  container.querySelectorAll(".word").forEach(w => {
    const lower = w.dataset.w || "";
    if (STOP_WORDS.has(lower)) {
      w.textContent = w.dataset.orig || "";
      w.dataset.revealed = "1";
    } else {
      w.dataset.revealed = "0";
    }
  });
}

function setMaskedMode(container, masked) {
  container.querySelectorAll(".word").forEach(w => {
    const lower = w.dataset.w || "";
    if (STOP_WORDS.has(lower)) {
      w.textContent = w.dataset.orig || "";
      w.dataset.revealed = "1";
      return;
    }
    if (masked) {
      w.textContent = w.dataset.mask || "";
      w.dataset.revealed = "0";
    } else {
      w.textContent = w.dataset.orig || "";
      w.dataset.revealed = "1";
    }
  });
}

// =====================
// Guess logic (open + highlight last guess + table)
// =====================
function matchesGuess(wordLower, guessLower) {
  if (guessLower.length < 5) return wordLower === guessLower;
  return wordLower.slice(0, 5) === guessLower.slice(0, 5);
}

function clearHighlight(container) {
  container.querySelectorAll(".word.hl").forEach(w => w.classList.remove("hl"));
}

function renderCheckedTable() {
  if (!checkedTable) return;
  if (checkedWords.length === 0) { checkedTable.textContent = "—"; return; }

  const sorted = [...checkedWords].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.t - b.t; // позднее ниже
  });

  checkedTable.innerHTML = sorted.map(x => `${x.word} — ${x.count}`).join("<br>");
}

function applyGuess(guessRaw) {
  if (!window.__gameDom) return;

const guess = normalizeForCompare(guessRaw || "");
  if (!guess) return;

  const container = window.__gameDom;

  clearHighlight(container);

  let count = 0;
  container.querySelectorAll(".word").forEach(w => {
    const wLower = w.dataset.w || "";
    if (matchesGuess(wLower, guess)) {
      count++;
      w.textContent = w.dataset.orig || "";
      w.dataset.revealed = "1";
      w.classList.add("hl");
    }
  });

  if (lastInfo) lastInfo.textContent = `${guess} — ${count}`;

  const key = keyForGuess(guess);
  if (!checkedKeySet.has(key)) {
    checkedKeySet.add(key);
    checkedWords.push({ word: guess, count, t: tCounter++, key });
    renderCheckedTable();
  }
}

// =====================
// UI flow
// =====================
async function startNewGame() {
  // show game screen
  startScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  // buttons: after start -> show Open, hide NewGame2
  openBtn.style.display = "inline-block";
  newGameBtn2.style.display = "none";

  // reset guess/table UI
  checkedWords = [];
  checkedKeySet = new Set();
  tCounter = 0;
  if (lastInfo) lastInfo.textContent = "—";
  if (checkedTable) checkedTable.textContent = "—";
  if (guessInput) { guessInput.value = ""; guessInput.focus(); }

  articleView.textContent = "Загрузка...";

  // load lists
  await loadStopWords();
  await loadArticles();

  // pick article
  const articleUrl = pickRandomArticleUrl();
  const title = titleFromWikiUrl(articleUrl);
  if (!title) {
    articleView.textContent = "Ошибка: не распознан URL статьи.";
    return;
  }

  try {
    const rawHtml = await fetchArticleHtmlByTitle(title);
    const cleanedHtml = cleanWikipediaHtml(rawHtml);

    const gameDom = buildGameDomFromCleanHtml(cleanedHtml);
    revealStopWords(gameDom);

    articleView.innerHTML = "";
    articleView.appendChild(gameDom);

    window.__gameDom = gameDom;
    window.__masked = true;
  } catch (e) {
    articleView.textContent = "Ошибка загрузки: " + (e?.message || String(e));
  }
}

function openAll() {
  if (!window.__gameDom) return;

  window.__masked = false;
  setMaskedMode(window.__gameDom, false);

  // after open -> hide Open, show NewGame2
  openBtn.style.display = "none";
  newGameBtn2.style.display = "inline-block";
}

// =====================
// Event handlers
// =====================
newGameBtn?.addEventListener("click", startNewGame);
newGameBtn2?.addEventListener("click", startNewGame);
openBtn?.addEventListener("click", openAll);

guessInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    applyGuess(guessInput.value);
    guessInput.value = "";
    guessInput.focus();
  }
});

// Make sure initial state is sane
// (If you hide newGameBtn2 in CSS, this still works)
try {
  // on load: show only start screen button
  if (newGameBtn2) newGameBtn2.style.display = "inline-block";
  if (openBtn) openBtn.style.display = "none";
} catch (_) {}
