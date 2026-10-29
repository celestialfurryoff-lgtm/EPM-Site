"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const envResult = dotenv.config({ path: path.join(__dirname, ".env") });
if (envResult.error && envResult.error.code !== "ENOENT") throw envResult.error;
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ArrowRight, ArrowUp, ArrowUpRight, ChevronDown, Sparkles } = require("lucide-react");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const LOCALES = ["fr", "en", "de"];
const PAGES = ["home", "project", "park", "progress", "team", "server", "contact"];
const GALLERY_IMAGE_TYPES = {
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
const NEWS_IMAGE_TYPES = {
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
const PAGE_LABELS = {
  home: "home",
  project: "project",
  park: "park",
  progress: "progress",
  team: "team",
  server: "server",
  contact: "contact"
};
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_MAX_REQUESTS = 5;
const contactAttempts = new Map();
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const adminLoginAttempts = new Map();
const localeData = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${locale}.json`), "utf8"))
  ])
);
const attractionNames = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "attractions.json"), "utf8"));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function icon(Component, className = "") {
  return renderToStaticMarkup(React.createElement(Component, {
    "aria-hidden": true,
    className: `icon ${className}`.trim(),
    focusable: false,
    size: 17,
    strokeWidth: 1.8
  }));
}

function routeFor(locale, page) {
  return page === "home" ? `/${locale}/` : `/${locale}/${page}`;
}

function getGalleryImages() {
  return fs.readdirSync(path.join(PUBLIC_DIR, "gallery"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name))
    .filter((entry) => Object.hasOwn(GALLERY_IMAGE_TYPES, path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

function getNewsTranslation(item, locale) {
  const translation = item.translations[locale] || item.translations.fr;
  return {
    category: translation.category || item.translations.fr.category,
    title: translation.title || item.translations.fr.title,
    summary: translation.summary || item.translations.fr.summary,
    body: translation.body || item.translations.fr.body || []
  };
}

function loadNews() {
  const news = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "actus.json"), "utf8"));
  if (!news || !Array.isArray(news.items)) {
    throw new Error("data/actus.json must contain an items array.");
  }

  return validateNewsItems(news.items);
}

function validateNewsItems(items) {
  if (!Array.isArray(items) || items.length > 500) {
    throw new Error("News items must be an array of at most 500 entries.");
  }
  const ids = new Set();
  for (const item of items) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
      ids.has(item.id)
    ) {
      throw new Error("Each news item needs a unique kebab-case id.");
    }
    ids.add(item.id);
    if (
      typeof item.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
      Number.isNaN(Date.parse(`${item.date}T00:00:00Z`)) ||
      new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) !== item.date
    ) {
      throw new Error(`News item "${item.id}" needs a valid YYYY-MM-DD date.`);
    }
    if (!item.translations || typeof item.translations.fr !== "object") {
      throw new Error(`News item "${item.id}" needs a French translation.`);
    }
    for (const locale of LOCALES) {
      const translation = item.translations[locale];
      if (translation === undefined) continue;
      if (
        !translation ||
        typeof translation.title !== "string" ||
        !translation.title.trim() ||
        translation.title.length > 180 ||
        typeof translation.summary !== "string" ||
        !translation.summary.trim() ||
        translation.summary.length > 1000 ||
        (translation.category !== undefined && (
          typeof translation.category !== "string" ||
          translation.category.length > 80
        )) ||
        (translation.body !== undefined && (
          !Array.isArray(translation.body) ||
          translation.body.length > 50 ||
          translation.body.some((paragraph) => typeof paragraph !== "string" || paragraph.length > 5000)
        ))
      ) {
        throw new Error(`News item "${item.id}" has an invalid ${locale} translation.`);
      }
    }
    if (item.image !== undefined && (
      typeof item.image !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.image) ||
      !Object.hasOwn(NEWS_IMAGE_TYPES, path.extname(item.image).toLowerCase())
    )) {
      throw new Error(`News item "${item.id}" has an invalid image filename.`);
    }
  }
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

function renderNewsList(newsItems, locale, progressContent) {
  if (!newsItems.length) {
    return `<div class="empty-state news-empty"><span class="empty-state-mark">${icon(Sparkles)}</span><p>${escapeHtml(progressContent.newsEmpty)}</p></div>`;
  }
  return `<div class="news-grid">${newsItems.map((item, index) => {
    const translation = getNewsTranslation(item, locale);
    const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${item.date}T00:00:00Z`));
    const image = item.image
      ? `<img class="news-cover-image" src="/assets/actus/${encodeURIComponent(item.image)}" alt="" loading="lazy">`
      : "";
    const body = translation.body.length
      ? `<details class="news-details"><summary>${escapeHtml(progressContent.newsReadMore)} ${icon(ChevronDown)}</summary><div class="news-body">${translation.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div></details>`
      : "";
    return `<article class="news-card reveal${index === 0 ? " news-card-featured" : ""}">
      <div class="news-cover${image ? " has-image" : ""}">${image}<span class="news-cover-number">${String(index + 1).padStart(2, "0")}</span><span class="news-cover-brand">EPM / ACTUALITÉS</span></div>
      <div class="news-card-content">
        <div class="news-meta"><span class="news-category">${escapeHtml(translation.category || translation.title)}</span><time datetime="${escapeHtml(item.date)}">${escapeHtml(date)}</time></div>
        <h3>${escapeHtml(translation.title)}</h3>
        <p class="news-summary">${escapeHtml(translation.summary)}</p>
        ${body}
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderHeader(locale, page, content) {
  const navItems = PAGES.map((item) => {
    const current = item === page ? ' aria-current="page"' : "";
    return `<a class="nav-link" href="${routeFor(locale, item)}"${current}>${escapeHtml(content.nav[item])}</a>`;
  }).join("");
  const languageLinks = LOCALES.map((code) => {
    const active = code === locale ? ' aria-current="true"' : "";
    return `<a class="language-link" href="${routeFor(code, page)}"${active} lang="${code}">${code.toUpperCase()}</a>`;
  }).join("");

  return `
    <a class="skip-link" href="#main">${locale === "fr" ? "Aller au contenu" : locale === "de" ? "Zum Inhalt springen" : "Skip to content"}</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="${routeFor(locale, "home")}" aria-label="${escapeHtml(content.siteName)} — ${escapeHtml(content.fullName)}">
          <span class="brand-mark" aria-hidden="true">E</span>
          <span class="brand-copy"><strong>${escapeHtml(content.siteName)}</strong><small>${escapeHtml(content.fullName)}</small></span>
        </a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-navigation" aria-label="${escapeHtml(content.menuLabel)}">
          <span></span><span></span>
        </button>
        <nav class="primary-navigation" id="primary-navigation" aria-label="${escapeHtml(content.navigationLabel)}">
          ${navItems}
        </nav>
        <div class="language-switch" aria-label="${escapeHtml(content.languageLabel)}">${languageLinks}</div>
      </div>
    </header>`;
}

function renderFooter(content) {
  return `
    <footer class="site-footer">
      <div class="footer-inner">
        <a class="footer-brand" href="#top"><span class="brand-mark brand-mark-small" aria-hidden="true">E</span><strong>${escapeHtml(content.siteName)}</strong></a>
        <p class="fan-notice">${escapeHtml(content.footer.fanNotice)}</p>
        <a class="back-to-top" href="#top">${escapeHtml(content.footer.backToTop)} ${icon(ArrowUp, "icon-small")}</a>
      </div>
    </footer>`;
}

function renderHome(locale, content) {
  const home = content.home;
  return `
    <section class="hero section-shell">
      <div class="hero-copy">
        <p class="eyebrow"><span class="eyebrow-dot"></span>${escapeHtml(home.eyebrow)}</p>
        <h1>${escapeHtml(home.title)}</h1>
        <p class="hero-lead">${escapeHtml(home.lead)}</p>
        <div class="hero-actions">
          <a class="button button-primary" href="${routeFor(locale, "progress")}">${escapeHtml(home.primaryAction)} ${icon(ArrowUpRight)}</a>
          <a class="text-link" href="${routeFor(locale, "project")}">${escapeHtml(home.secondaryAction)} ${icon(ArrowRight)}</a>
        </div>
        <div class="hero-statuses" aria-label="${escapeHtml(home.eyebrow)}">
          <div class="status-inline"><span class="status-dot"></span><span><small>${escapeHtml(home.projectStatusLabel)}</small><strong>${escapeHtml(home.projectStatus)}</strong></span></div>
          <div class="status-inline"><span class="status-dot status-dot-gold"></span><span><small>${escapeHtml(home.serverStatusLabel)}</small><strong>${escapeHtml(home.serverStatus)}</strong></span></div>
        </div>
      </div>
      <div class="hero-art" role="img" aria-label="${escapeHtml(home.visualLabel)}">
        <div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div>
        <div class="art-sun"></div><div class="art-horizon"></div>
        <div class="art-tower tower-left"></div><div class="art-tower tower-mid"></div><div class="art-tower tower-right"></div>
        <div class="art-block block-one"></div><div class="art-block block-two"></div><div class="art-block block-three"></div>
        <div class="art-label"><span class="art-label-kicker">${escapeHtml(home.visualLabel)}</span><strong>${escapeHtml(home.visualCaption)}</strong><span class="art-label-mark" aria-hidden="true">EPM / 01</span></div>
      </div>
    </section>
    <section class="intro-section section-shell reveal">
      <div class="section-heading">
        <p class="eyebrow">${escapeHtml(home.sectionEyebrow)}</p>
        <h2>${escapeHtml(home.sectionTitle)}</h2>
      </div>
      <div class="section-aside"><p>${escapeHtml(home.sectionText)}</p><a class="text-link" href="${routeFor(locale, "project")}">${escapeHtml(home.sectionAction)} ${icon(ArrowRight)}</a></div>
    </section>
    <section class="home-bottom section-shell reveal">
      <div class="gallery-preview">
        <div class="preview-symbol" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><p class="eyebrow">${escapeHtml(home.galleryTitle)}</p><p>${escapeHtml(home.galleryText)}</p><a class="text-link" href="${routeFor(locale, "park")}">${escapeHtml(home.galleryAction)} ${icon(ArrowRight)}</a></div>
      </div>
      <a class="contact-card" href="${routeFor(locale, "contact")}"><span class="contact-card-index">01 / CONTACT</span><strong>${escapeHtml(content.nav.contact)}</strong>${icon(ArrowUpRight, "contact-card-arrow")}</a>
    </section>`;
}

function renderProject(locale, content) {
  const page = content.project;
  const facts = page.facts.map((fact, index) => `
    <article class="fact-card reveal">
      <span class="fact-index">0${index + 1}</span>
      <span class="fact-label">${escapeHtml(fact.label)}</span>
      <strong>${escapeHtml(fact.value)}</strong>
    </article>`).join("");
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}
    <section class="facts-grid section-shell">${facts}</section>
    <section class="note-panel section-shell reveal"><span class="panel-mark" aria-hidden="true">EPM</span><div><p class="eyebrow">${escapeHtml(page.noteTitle)}</p><p>${escapeHtml(page.noteText)}</p></div></section>`;
}

function renderPark(locale, content) {
  const page = content.park;
  const attractions = attractionNames.names.map((name, index) => `
    <li class="attraction-card reveal">
      <span class="attraction-index">${String(index + 1).padStart(3, "0")}</span>
      <strong class="attraction-name" lang="de">${escapeHtml(name)}</strong>
      <span class="attraction-status">${escapeHtml(page.attractionStatus)}</span>
    </li>`).join("");
  const images = getGalleryImages();
  const gallery = images.length
    ? images.map((filename, index) => {
      const source = `/assets/gallery/${encodeURIComponent(filename)}`;
      const alt = `${page.captureLabel} ${index + 1}`;
      return `<button class="gallery-image-button reveal" type="button" data-gallery-image="${escapeHtml(source)}" data-gallery-alt="${escapeHtml(alt)}"><img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy"><span class="gallery-image-index">0${index + 1} / EPM</span>${icon(ArrowUpRight, "gallery-image-open")}</button>`;
    }).join("")
    : [1, 2, 3].map((number) => `
      <div class="gallery-placeholder reveal" aria-label="${escapeHtml(page.captureLabel)}">
        <span class="placeholder-number">0${number}</span><span class="placeholder-cross" aria-hidden="true">+</span><span class="placeholder-label">${escapeHtml(page.captureLabel)}</span>
      </div>`).join("");
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}
    <section class="content-section section-shell reveal">
      <div class="section-heading"><p class="eyebrow">${escapeHtml(page.zonesTitle)}</p><h2>${escapeHtml(page.zonesTitle)}</h2><p class="section-description">${escapeHtml(page.zonesText)}</p></div>
      <ul class="attraction-list">${attractions}</ul>
      <a class="text-link attraction-source" href="${escapeHtml(attractionNames.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(page.catalogLinkLabel)} ${icon(ArrowUpRight)}</a>
    </section>
    <section class="content-section section-shell reveal">
      <div class="section-heading"><p class="eyebrow">${escapeHtml(page.galleryTitle)}</p><h2>${escapeHtml(page.galleryTitle)}</h2><p class="section-description">${escapeHtml(page.galleryText)}</p></div>
      <div class="gallery-grid">${gallery}</div>
    </section>`;
}

function renderProgress(locale, content) {
  const page = content.progress;
  const newsItems = loadNews();
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}
    <section class="progress-grid section-shell">
      <article class="progress-card progress-card-light reveal"><span class="card-overline">01 / ${escapeHtml(page.projectStatusLabel)}</span><span class="progress-orbit" aria-hidden="true"></span><p class="eyebrow">${escapeHtml(page.projectStatusLabel)}</p><h2>${escapeHtml(page.projectStatus)}</h2><div class="qualitative-line"><span></span></div></article>
      <article class="progress-card progress-card-dark reveal"><span class="card-overline">02 / ${escapeHtml(page.serverStatusLabel)}</span><span class="progress-square" aria-hidden="true"></span><p class="eyebrow">${escapeHtml(page.serverStatusLabel)}</p><h2>${escapeHtml(page.serverStatus)}</h2><div class="qualitative-line"><span></span></div></article>
    </section>
    <section class="content-section section-shell reveal"><div class="section-heading"><p class="eyebrow">${escapeHtml(page.newsTitle)}</p><h2>${escapeHtml(page.newsTitle)}</h2><p class="section-description">${escapeHtml(page.newsText)}</p></div>${renderNewsList(newsItems, locale, page)}</section>`;
}

function renderTeam(locale, content) {
  const page = content.team;
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}
    <section class="team-grid section-shell">
      <article class="team-card reveal"><span class="card-overline">01 / EPM</span><p class="eyebrow">${escapeHtml(page.teamTitle)}</p><h2>${escapeHtml(page.teamTitle)}</h2><p>${escapeHtml(page.teamText)}</p></article>
      <article class="team-card team-card-accent reveal"><span class="card-overline">02 / EPM</span><p class="eyebrow">${escapeHtml(page.recruitmentTitle)}</p><h2>${escapeHtml(page.recruitmentTitle)}</h2><p>${escapeHtml(page.recruitmentText)}</p><a class="text-link" href="${routeFor(locale, "contact")}">${escapeHtml(page.contactAction)} ${icon(ArrowRight)}</a></article>
    </section>`;
}

function renderServer(content) {
  const page = content.server;
  const rows = [
    [page.versionLabel, page.version],
    [page.loaderLabel, page.loader],
    [page.statusLabel, page.status],
    [page.addressLabel, page.address]
  ].map(([label, value], index) => `<div class="server-row reveal"><span class="server-row-index">0${index + 1}</span><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}<section class="server-list section-shell">${rows}</section>`;
}

function renderContact(content) {
  const page = content.contact;
  return `${renderPageHeading(page.eyebrow, page.title, page.intro)}
    <section class="contact-layout section-shell">
      <div class="contact-aside reveal"><span class="contact-aside-number">EPM / 07</span><p>${escapeHtml(page.privacyNote)}</p><div class="contact-aside-line"></div><span class="contact-aside-label">${escapeHtml(content.fullName)}</span></div>
      <form class="contact-form reveal" id="contact-form" data-submit-label="${escapeHtml(page.submitLabel)}" data-sending-label="${escapeHtml(page.sendingLabel)}" data-success-message="${escapeHtml(page.successMessage)}" data-error-generic="${escapeHtml(page.errorGeneric)}" data-error-not-configured="${escapeHtml(page.errorNotConfigured)}" data-error-invalid="${escapeHtml(page.errorInvalid)}" data-error-rate-limit="${escapeHtml(page.errorRateLimit)}" data-error-upstream="${escapeHtml(page.errorUpstream)}">
        <label class="honeypot" aria-hidden="true">${escapeHtml(page.honeypotLabel)}<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
        <div class="form-field"><label for="discord">${escapeHtml(page.discordLabel)}</label><input id="discord" name="discord" type="text" minlength="2" maxlength="80" autocomplete="nickname" placeholder="${escapeHtml(page.discordPlaceholder)}" required></div>
        <div class="form-field"><label for="subject">${escapeHtml(page.subjectLabel)}</label><input id="subject" name="subject" type="text" minlength="2" maxlength="120" placeholder="${escapeHtml(page.subjectPlaceholder)}" required></div>
        <div class="form-field"><label for="message">${escapeHtml(page.messageLabel)}</label><textarea id="message" name="message" rows="5" minlength="5" maxlength="2000" placeholder="${escapeHtml(page.messagePlaceholder)}" required></textarea></div>
        <label class="consent-field"><input name="consent" type="checkbox" required><span>${escapeHtml(page.consentText)}</span></label>
        <p class="form-feedback" id="form-feedback" role="status" aria-live="polite"></p>
        <button class="button button-primary form-submit" type="submit"><span>${escapeHtml(page.submitLabel)}</span>${icon(ArrowUpRight)}</button>
      </form>
    </section>`;
}

function renderPageHeading(eyebrow, title, intro) {
  return `<section class="page-heading section-shell"><p class="eyebrow"><span class="eyebrow-dot"></span>${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="page-intro">${escapeHtml(intro)}</p></section>`;
}

function renderPage(locale, page) {
  const content = localeData[locale];
  const pageContent = {
    home: () => renderHome(locale, content),
    project: () => renderProject(locale, content),
    park: () => renderPark(locale, content),
    progress: () => renderProgress(locale, content),
    team: () => renderTeam(locale, content),
    server: () => renderServer(content),
    contact: () => renderContact(content)
  }[page]();

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(content.metaDescription)}">
  <meta name="theme-color" content="#111a24">
  <title>${escapeHtml(page === "home" ? `${content.siteName} — ${content.fullName}` : `${content.nav[PAGE_LABELS[page]]} — ${content.siteName}`)}</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="/assets/app.js" defer></script>
</head>
<body id="top" data-page="${page}" data-locale="${locale}">
  ${renderHeader(locale, page, content)}
  <main id="main">${pageContent}</main>
  ${renderFooter(content)}
</body>
</html>`;
}

function send(res, status, body, contentType = "text/html; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function writeJsonFile(filePath, data) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      fs.copyFileSync(temporaryPath, filePath);
      fs.unlinkSync(temporaryPath);
    }
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function isSameOrigin(req) {
  try {
    return Boolean(req.headers.origin) &&
      new URL(req.headers.origin).host === req.headers.host &&
      ["http:", "https:"].includes(new URL(req.headers.origin).protocol);
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function hasSecureCookie(req) {
  return Boolean(req.socket.encrypted) || process.env.NODE_ENV === "production";
}

function secureStringEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(String(left)).digest();
  const rightHash = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function getAdminSession(req, sessions) {
  const token = getCookie(req, "epm_admin");
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + ADMIN_SESSION_MS;
  return { token, ...session };
}

function isValidContentShape(candidate, reference) {
  if (typeof reference === "string") return typeof candidate === "string" && candidate.length <= 10000;
  if (Array.isArray(reference)) {
    return Array.isArray(candidate) &&
      candidate.length === reference.length &&
      reference.every((value, index) => isValidContentShape(candidate[index], value));
  }
  if (reference && typeof reference === "object") {
    return candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      Object.keys(candidate).length === Object.keys(reference).length &&
      Object.keys(reference).every((key) => Object.hasOwn(candidate, key) && isValidContentShape(candidate[key], reference[key]));
  }
  return typeof candidate === typeof reference;
}

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return { extension: ".avif", mimeType: "image/avif" };
  }
  return null;
}

function takeLoginAttempt(key, now = Date.now()) {
  for (const [client, entry] of adminLoginAttempts) {
    if (now - entry.startedAt >= ADMIN_LOGIN_WINDOW_MS) adminLoginAttempts.delete(client);
  }
  const entry = adminLoginAttempts.get(key);
  if (!entry || now - entry.startedAt >= ADMIN_LOGIN_WINDOW_MS) {
    if (adminLoginAttempts.size >= 10000) {
      adminLoginAttempts.delete(adminLoginAttempts.keys().next().value);
    }
    adminLoginAttempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > ADMIN_LOGIN_MAX_ATTEMPTS;
}

function renderAdminPage() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#111a24">
  <title>Administration — EPM</title>
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/admin.css">
  <script src="/assets/admin.js" defer></script>
</head>
<body class="admin-body">
  <main class="admin-shell">
    <header class="admin-header">
      <a class="admin-brand" href="/fr/"><span class="admin-mark">E</span><span><strong>EPM / ADMIN</strong><small>Gestion du site</small></span></a>
      <button class="admin-button admin-logout" id="admin-logout" type="button" hidden>Déconnexion</button>
    </header>
    <div class="admin-notice" id="admin-notice" role="status" aria-live="polite"></div>
    <section class="admin-login admin-panel" id="admin-login-panel" hidden>
      <p class="admin-eyebrow">Espace privé</p><h1>Administration</h1>
      <p>Connectez-vous pour gérer les actualités, les images de la galerie et les textes du site.</p>
      <form id="admin-login-form">
        <label for="admin-password">Mot de passe administrateur</label>
        <input id="admin-password" name="password" type="password" autocomplete="current-password" required>
        <button class="admin-button admin-primary" type="submit">Se connecter</button>
      </form>
    </section>
    <section class="admin-unconfigured admin-panel" id="admin-unconfigured" hidden>
      <p class="admin-eyebrow">Configuration requise</p><h1>Administration non configurée</h1>
      <p>Définissez <code>ADMIN_PASSWORD</code> sur le serveur avec au moins 16 caractères, puis redémarrez le site. Aucun mot de passe par défaut n’est activé.</p>
    </section>
    <section id="admin-app" hidden>
      <div class="admin-welcome"><div><p class="admin-eyebrow">Espace de gestion</p><h1>Tableau de bord</h1></div><p>Les modifications sont publiées sur le site dès leur enregistrement.</p></div>
      <nav class="admin-tabs" aria-label="Sections d’administration">
        <button type="button" data-tab="news" aria-selected="true">Actualités</button>
        <button type="button" data-tab="gallery" aria-selected="false">Galerie</button>
        <button type="button" data-tab="attractions" aria-selected="false">Attractions</button>
        <button type="button" data-tab="content" aria-selected="false">Textes du site</button>
      </nav>
      <section class="admin-section" id="admin-news" data-panel="news">
        <div class="admin-section-heading"><div><p class="admin-eyebrow">Publication</p><h2>Actualités</h2></div><button class="admin-button admin-primary" id="news-new" type="button">Nouvelle actualité</button></div>
        <div class="news-editor admin-panel" id="news-editor" hidden>
          <div class="admin-section-heading"><h3 id="news-editor-title">Nouvelle actualité</h3><button class="admin-button admin-quiet" id="news-cancel" type="button">Annuler</button></div>
          <form id="news-form">
            <input id="news-id" type="hidden">
            <div class="admin-form-grid">
              <label>ID (kebab-case)<input id="news-slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="80"></label>
              <label>Date<input id="news-date" type="date" required></label>
              <label class="admin-span">Image de couverture (facultatif)<input id="news-image" type="text" readonly placeholder="Aucune image sélectionnée"><span class="admin-upload-row"><input id="news-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif"><button class="admin-button" id="news-image-upload" type="button">Importer une couverture</button></span></label>
            </div>
            <div class="admin-locale-grid">
              <fieldset><legend>Français (obligatoire)</legend><label>Catégorie<input data-locale="fr" data-field="category" maxlength="80"></label><label>Titre<input data-locale="fr" data-field="title" required maxlength="180"></label><label>Résumé<textarea data-locale="fr" data-field="summary" required maxlength="1000" rows="3"></textarea></label><label>Article complet (un paragraphe par ligne)<textarea data-locale="fr" data-field="body" rows="4"></textarea></label></fieldset>
              <fieldset><legend>English (optional)</legend><label>Category<input data-locale="en" data-field="category" maxlength="80"></label><label>Title<input data-locale="en" data-field="title" maxlength="180"></label><label>Summary<textarea data-locale="en" data-field="summary" maxlength="1000" rows="3"></textarea></label><label>Article (one paragraph per line)<textarea data-locale="en" data-field="body" rows="4"></textarea></label></fieldset>
              <fieldset><legend>Deutsch (optional)</legend><label>Kategorie<input data-locale="de" data-field="category" maxlength="80"></label><label>Titel<input data-locale="de" data-field="title" maxlength="180"></label><label>Zusammenfassung<textarea data-locale="de" data-field="summary" maxlength="1000" rows="3"></textarea></label><label>Artikel (ein Absatz pro Zeile)<textarea data-locale="de" data-field="body" rows="4"></textarea></label></fieldset>
            </div>
            <button class="admin-button admin-primary" type="submit">Enregistrer l’actualité</button>
          </form>
        </div>
        <div class="admin-list" id="news-list"></div>
      </section>
      <section class="admin-section" id="admin-gallery" data-panel="gallery" hidden>
        <div class="admin-section-heading"><div><p class="admin-eyebrow">Médias du parc</p><h2>Galerie</h2></div><label class="admin-button admin-primary admin-file-button">Importer des images<input id="gallery-upload" type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple></label></div>
        <p class="admin-help">PNG, JPEG, WebP ou AVIF — 4 Mo maximum par image.</p>
        <div class="admin-gallery-grid" id="gallery-grid"></div>
      </section>
      <section class="admin-section" id="admin-attractions" data-panel="attractions" hidden>
        <div class="admin-section-heading"><div><p class="admin-eyebrow">Catalogue du parc</p><h2>Quartiers et attractions</h2></div></div>
        <p class="admin-help">Une attraction par ligne. Le statut affiché par langue se modifie dans « Textes du site ».</p>
        <label class="admin-textarea-label" for="attractions-names">Liste des noms</label>
        <textarea class="content-editor attraction-editor" id="attractions-names" spellcheck="false"></textarea>
        <label class="admin-textarea-label" for="attractions-source">Source du catalogue</label>
        <input class="admin-source-input" id="attractions-source" type="url" required>
        <button class="admin-button admin-primary" id="attractions-save" type="button">Enregistrer le catalogue</button>
      </section>
      <section class="admin-section" id="admin-content" data-panel="content" hidden>
        <div class="admin-section-heading"><div><p class="admin-eyebrow">Informations et textes</p><h2>Contenu du site</h2></div></div>
        <p class="admin-help">Modifiez le JSON d’une langue. Les clés et la structure sont protégées pour éviter de casser le site.</p>
        <label class="admin-locale-select" for="content-locale">Langue<select id="content-locale"><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option></select></label>
        <textarea class="content-editor" id="content-json" spellcheck="false" aria-label="Contenu JSON du site"></textarea>
        <button class="admin-button admin-primary" id="content-save" type="button">Enregistrer les textes</button>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function getClientKey(req) {
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(key, now = Date.now()) {
  for (const [client, entry] of contactAttempts) {
    if (now - entry.startedAt >= CONTACT_WINDOW_MS) contactAttempts.delete(client);
  }
  const entry = contactAttempts.get(key);
  if (!entry || now - entry.startedAt >= CONTACT_WINDOW_MS) {
    if (contactAttempts.size >= 10000) {
      contactAttempts.delete(contactAttempts.keys().next().value);
    }
    contactAttempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  if (entry.count >= CONTACT_MAX_REQUESTS) return true;
  entry.count += 1;
  return false;
}

function readJsonBody(req, maxBytes = 8 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateContactPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const discord = typeof payload.discord === "string" ? payload.discord.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (
    typeof payload.website !== "string" ||
    payload.website.length !== 0 ||
    payload.consent !== true ||
    discord.length < 2 ||
    discord.length > 80 ||
    subject.length < 2 ||
    subject.length > 120 ||
    message.length < 5 ||
    message.length > 2000
  ) return null;
  return { discord, subject, message };
}

function isValidWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["discord.com", "discordapp.com"].includes(url.hostname) &&
      /^\/api\/webhooks\/\d+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function adminCookie(token, req, maxAge) {
  const secure = hasSecureCookie(req) ? "; Secure" : "";
  return `epm_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function handleAdminApi(req, res, requestUrl, admin) {
  const pathname = requestUrl.pathname;
  const method = req.method;
  if (pathname === "/admin/api/login" && method === "POST") {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "origin_not_allowed" });
      return;
    }
    if (!admin.password || admin.password.length < 16) {
      sendJson(res, 503, { error: "admin_not_configured" });
      return;
    }
    const clientKey = getClientKey(req);
    if (takeLoginAttempt(clientKey)) {
      sendJson(res, 429, { error: "rate_limited" });
      return;
    }
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: "invalid_request" });
      return;
    }
    if (!payload || typeof payload.password !== "string" || !secureStringEqual(payload.password, admin.password)) {
      sendJson(res, 401, { error: "invalid_credentials" });
      return;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const session = { csrfToken: crypto.randomBytes(32).toString("base64url"), expiresAt: Date.now() + ADMIN_SESSION_MS };
    for (const [sessionToken, existingSession] of admin.sessions) {
      if (existingSession.expiresAt <= Date.now()) admin.sessions.delete(sessionToken);
    }
    if (admin.sessions.size >= 1000) admin.sessions.delete(admin.sessions.keys().next().value);
    admin.sessions.set(token, session);
    adminLoginAttempts.delete(clientKey);
    res.setHeader("Set-Cookie", adminCookie(token, req, ADMIN_SESSION_MS / 1000));
    sendJson(res, 200, { ok: true, csrfToken: session.csrfToken });
    return;
  }

  if (pathname === "/admin/api/session" && method === "GET") {
    if (!admin.password || admin.password.length < 16) {
      sendJson(res, 503, { error: "admin_not_configured" });
      return;
    }
    const session = getAdminSession(req, admin.sessions);
    if (!session) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    sendJson(res, 200, { csrfToken: session.csrfToken });
    return;
  }

  const session = getAdminSession(req, admin.sessions);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (method !== "GET") {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "origin_not_allowed" });
      return;
    }
    if (!secureStringEqual(req.headers["x-csrf-token"] || "", session.csrfToken)) {
      sendJson(res, 403, { error: "csrf_invalid" });
      return;
    }
  }

  if (pathname === "/admin/api/session" && method === "DELETE") {
    admin.sessions.delete(session.token);
    res.setHeader("Set-Cookie", adminCookie("", req, 0));
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === "/admin/api/news" && method === "GET") {
    sendJson(res, 200, { items: loadNews() });
    return;
  }
  if (pathname === "/admin/api/news" && method === "PUT") {
    let payload;
    try {
      payload = await readJsonBody(req, 256 * 1024);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.items)) {
        sendJson(res, 400, { error: "invalid_news" });
        return;
      }
      const items = validateNewsItems(payload.items);
      writeJsonFile(path.join(DATA_DIR, "actus.json"), { items });
      sendJson(res, 200, { items });
    } catch (error) {
      if (error.statusCode) {
        sendJson(res, error.statusCode, { error: "invalid_request" });
      } else if (error instanceof SyntaxError || error.message.includes("News") || error.message.includes("news item") || error.message.includes("Each news")) {
        sendJson(res, 400, { error: "invalid_news", message: error.message });
      } else {
        throw error;
      }
    }
    return;
  }
  if (pathname === "/admin/api/gallery" && method === "GET") {
    sendJson(res, 200, { images: getGalleryImages() });
    return;
  }
  if (pathname === "/admin/api/attractions" && method === "GET") {
    sendJson(res, 200, { names: attractionNames.names, source: attractionNames.source });
    return;
  }
  if (pathname === "/admin/api/attractions" && method === "PUT") {
    let payload;
    try {
      payload = await readJsonBody(req, 128 * 1024);
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !Array.isArray(payload.names) ||
        payload.names.length < 1 ||
        payload.names.length > 300 ||
        payload.names.some((name) => typeof name !== "string" || !name.trim() || name.length > 180) ||
        new Set(payload.names.map((name) => name.trim().toLocaleLowerCase())).size !== payload.names.length ||
        typeof payload.source !== "string" ||
        !/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?$/.test(payload.source)
      ) {
        sendJson(res, 400, { error: "invalid_attractions" });
        return;
      }
      const updated = { names: payload.names.map((name) => name.trim()), source: payload.source };
      writeJsonFile(path.join(DATA_DIR, "attractions.json"), updated);
      attractionNames.names = updated.names;
      attractionNames.source = updated.source;
      sendJson(res, 200, updated);
    } catch (error) {
      if (error.statusCode) sendJson(res, error.statusCode, { error: "invalid_request" });
      else if (error instanceof SyntaxError) sendJson(res, 400, { error: "invalid_json" });
      else throw error;
    }
    return;
  }
  const galleryMatch = /^\/admin\/api\/gallery\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname);
  if (galleryMatch && method === "DELETE") {
    const filename = galleryMatch[1];
    if (!Object.hasOwn(GALLERY_IMAGE_TYPES, path.extname(filename).toLowerCase())) {
      sendJson(res, 400, { error: "invalid_filename" });
      return;
    }
    const imagePath = path.join(PUBLIC_DIR, "gallery", filename);
    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    fs.unlinkSync(imagePath);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === "/admin/api/upload" && method === "POST") {
    let payload;
    try {
      payload = await readJsonBody(req, Math.ceil(ADMIN_MAX_IMAGE_BYTES * 1.4) + 1024);
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: "invalid_request" });
      return;
    }
    if (
      !payload ||
      !["gallery", "news"].includes(payload.area) ||
      typeof payload.data !== "string" ||
      payload.data.length > Math.ceil(ADMIN_MAX_IMAGE_BYTES * 4 / 3) + 8 ||
      payload.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data)
    ) {
      sendJson(res, 400, { error: "invalid_image" });
      return;
    }
    const imageBuffer = Buffer.from(payload.data, "base64");
    const imageType = detectImageType(imageBuffer);
    if (!imageType || !imageBuffer.length || imageBuffer.length > ADMIN_MAX_IMAGE_BYTES) {
      sendJson(res, 400, { error: "invalid_image" });
      return;
    }
    const filename = `${crypto.randomUUID()}${imageType.extension}`;
    const folder = payload.area === "gallery" ? "gallery" : "actus";
    fs.writeFileSync(path.join(PUBLIC_DIR, folder, filename), imageBuffer, { flag: "wx", mode: 0o644 });
    sendJson(res, 201, { filename, url: `/assets/${payload.area === "gallery" ? "gallery" : "actus"}/${filename}` });
    return;
  }
  const contentMatch = /^\/admin\/api\/content\/(fr|en|de)$/.exec(pathname);
  if (contentMatch && method === "GET") {
    const locale = contentMatch[1];
    const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${locale}.json`), "utf8"));
    sendJson(res, 200, { content });
    return;
  }
  if (contentMatch && method === "PUT") {
    const locale = contentMatch[1];
    let payload;
    try {
      payload = await readJsonBody(req, 64 * 1024);
      if (!isValidContentShape(payload.content, localeData[locale])) {
        sendJson(res, 400, { error: "invalid_content_shape" });
        return;
      }
      writeJsonFile(path.join(DATA_DIR, `${locale}.json`), payload.content);
      localeData[locale] = payload.content;
      sendJson(res, 200, { ok: true });
    } catch (error) {
      if (error.statusCode) sendJson(res, error.statusCode, { error: "invalid_request" });
      else if (error instanceof SyntaxError) sendJson(res, 400, { error: "invalid_json" });
      else throw error;
    }
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}

async function handleContact(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    sendJson(res, 415, { error: "unsupported_media_type" });
    return;
  }
  const origin = req.headers.origin;
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {
    originHost = "";
  }
  if (!originHost || originHost !== req.headers.host) {
    sendJson(res, 403, { error: "origin_not_allowed" });
    return;
  }
  if (isRateLimited(getClientKey(req))) {
    sendJson(res, 429, { error: "rate_limited" });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: "invalid_request" });
    return;
  }
  const contact = validateContactPayload(payload);
  if (!contact) {
    sendJson(res, 400, { error: "invalid_fields" });
    return;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
  if (!isValidWebhook(webhookUrl)) {
    console.error("Contact form unavailable: Discord webhook is missing or invalid.");
    sendJson(res, 503, { error: "not_configured" });
    return;
  }

  const discordPayload = {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: contact.subject,
      description: contact.message,
      color: 11970389,
      fields: [{ name: "Discord", value: contact.discord, inline: true }],
      footer: { text: "EPM — formulaire de contact" },
      timestamp: new Date().toISOString()
    }]
  };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.error(`Discord webhook returned HTTP ${response.status}.`);
      sendJson(res, 502, { error: "delivery_failed" });
      return;
    }
  } catch {
    console.error("Discord webhook request failed.");
    sendJson(res, 502, { error: "delivery_failed" });
    return;
  }
  sendJson(res, 200, { ok: true });
}

function createServer(options = {}) {
  const admin = {
    password: options.adminPassword === undefined ? process.env.ADMIN_PASSWORD || "" : options.adminPassword,
    sessions: new Map()
  };
  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin/") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          send(res, 405, "Method not allowed");
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        send(res, 200, req.method === "HEAD" ? "" : renderAdminPage());
        return;
      }
      if (requestUrl.pathname === "/admin/api" || requestUrl.pathname.startsWith("/admin/api/")) {
        res.setHeader("Cache-Control", "no-store");
        await handleAdminApi(req, res, requestUrl, admin);
        return;
      }
      if (requestUrl.pathname === "/api/contact") {
        await handleContact(req, res);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "Method not allowed");
        return;
      }
      if (requestUrl.pathname === "/") {
        res.writeHead(302, { Location: "/fr/" });
        res.end();
        return;
      }
      const assetFiles = {
        "/assets/styles.css": ["styles.css", "text/css; charset=utf-8"],
        "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/assets/favicon.svg": ["favicon.svg", "image/svg+xml"],
        "/assets/admin.css": ["admin.css", "text/css; charset=utf-8"],
        "/assets/admin.js": ["admin.js", "text/javascript; charset=utf-8"]
      };
      if (assetFiles[requestUrl.pathname]) {
        const [fileName, mimeType] = assetFiles[requestUrl.pathname];
        const filePath = path.join(PUBLIC_DIR, fileName);
        const body = fs.readFileSync(filePath);
        send(res, 200, req.method === "HEAD" ? "" : body, mimeType);
        return;
      }
      const galleryMatch = /^\/assets\/gallery\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(requestUrl.pathname);
      if (galleryMatch) {
        const extension = path.extname(galleryMatch[1]).toLowerCase();
        if (Object.hasOwn(GALLERY_IMAGE_TYPES, extension)) {
          const filePath = path.join(PUBLIC_DIR, "gallery", galleryMatch[1]);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const body = fs.readFileSync(filePath);
            send(res, 200, req.method === "HEAD" ? "" : body, GALLERY_IMAGE_TYPES[extension]);
            return;
          }
        }
        send(res, 404, "Not found");
        return;
      }
      const newsImageMatch = /^\/assets\/actus\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(requestUrl.pathname);
      if (newsImageMatch) {
        const extension = path.extname(newsImageMatch[1]).toLowerCase();
        if (Object.hasOwn(NEWS_IMAGE_TYPES, extension)) {
          const filePath = path.join(PUBLIC_DIR, "actus", newsImageMatch[1]);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const body = fs.readFileSync(filePath);
            send(res, 200, req.method === "HEAD" ? "" : body, NEWS_IMAGE_TYPES[extension]);
            return;
          }
        }
        send(res, 404, "Not found");
        return;
      }

      const segments = requestUrl.pathname.split("/").filter(Boolean);
      const locale = segments[0];
      const page = segments[1] || "home";
      if (!LOCALES.includes(locale) || segments.length > 2 || !PAGES.includes(page)) {
        send(res, 404, "Not found");
        return;
      }
      send(res, 200, renderPage(locale, page));
    } catch (error) {
      console.error("Request handler failed.", error);
      if (!res.headersSent) send(res, 500, "Internal server error");
      else res.end();
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`EPM site listening on port ${PORT}.`);
  });
}

module.exports = {
  createServer,
  getGalleryImages,
  loadNews,
  renderPage,
  renderNewsList,
  validateContactPayload,
  isValidWebhook
};
