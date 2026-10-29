"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { createServer, getGalleryImages, isValidWebhook, loadNews, renderNewsList, validateContactPayload } = require("../server");

async function startServer(options) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("locale routes render translated pages and omit unconfirmed numerical progress", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));

  const [home, park, progress] = await Promise.all([
    fetch(`${origin}/fr/`),
    fetch(`${origin}/de/park`),
    fetch(`${origin}/en/progress`)
  ]);
  assert.equal(home.status, 200);
  const homeHtml = await home.text();
  assert.match(homeHtml, /Europa-Park, à l’échelle 1:1/);
  assert.match(homeHtml, /<svg[^>]*class="lucide lucide-arrow-up-right icon"/);
  assert.doesNotMatch(homeHtml, /[→↗↑]/);
  assert.equal(park.status, 200);
  assert.match(await park.text(), /Der Park/);
  const contactResponse = await fetch(`${origin}/fr/contact`);
  const contactHtml = await contactResponse.text();
  assert.match(contactHtml, /id="discord"[^>]*minlength="2"/);
  assert.match(contactHtml, /id="subject"[^>]*minlength="2"/);
  assert.match(contactHtml, /id="message"[^>]*minlength="5"/);
  const progressHtml = await progress.text();
  assert.equal(progress.status, 200);
  assert.match(progressHtml, /Building/);
  assert.doesNotMatch(progressHtml, /(?:\b\d{1,3}%\b|progressbar)/i);
  assert.match(progressHtml, /Test news article/);
});

test("news file contains the clearly labeled test article", () => {
  const news = loadNews();
  assert.equal(news.length, 1);
  assert.equal(news[0].id, "actu-test");
  assert.equal(news[0].translations.fr.category, "Test");
  assert.match(news[0].translations.fr.body[0], /pas une annonce officielle/);
});

test("news cards render localized content, dates and escaped body paragraphs", () => {
  const progressContent = {
    newsEmpty: "Pas encore d’actualité.",
    newsReadMore: "Lire l’article"
  };
  const items = [{
    id: "latest",
    date: "2026-10-29",
    translations: {
      fr: {
        category: "Construction",
        title: "<Projet> confirmé",
        summary: "Résumé du projet.",
        body: ["Premier paragraphe.", "<script>alert(1)</script>"]
      },
      en: {
        category: "Build",
        title: "Project confirmed",
        summary: "A project update.",
        body: ["First paragraph."]
      }
    }
  }];
  const html = renderNewsList(items, "en", progressContent);
  assert.match(html, /Project confirmed/);
  assert.match(html, /October 29, 2026/);
  assert.match(html, /First paragraph\./);
  assert.doesNotMatch(html, /<script>/);
  const fallbackHtml = renderNewsList(items, "de", progressContent);
  assert.match(fallbackHtml, /&lt;Projet&gt; confirmé/);
  assert.match(fallbackHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("news images are served only from the news image folder", async (t) => {
  const { server, origin } = await startServer();
  const imageName = `news-test-${process.pid}.png`;
  const imagePath = require("node:path").join(__dirname, "..", "public", "actus", imageName);
  fs.copyFileSync(require("node:path").join(__dirname, "..", "public", "gallery", "image.png"), imagePath);
  t.after(async () => {
    await closeServer(server);
    fs.rmSync(imagePath, { force: true });
  });

  const response = await fetch(`${origin}/assets/actus/${imageName}`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${origin}/assets/actus/not-found.png`)).status, 404);
});

test("admin is disabled without a strong configured password", async (t) => {
  const { server, origin } = await startServer({ adminPassword: "" });
  t.after(() => closeServer(server));
  assert.equal((await fetch(`${origin}/admin`)).status, 200);
  assert.equal((await fetch(`${origin}/admin/api/session`)).status, 503);
  const response = await fetch(`${origin}/admin/api/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "anything" })
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "admin_not_configured" });
});

test("admin authenticates, protects requests and manages site content", async (t) => {
  const password = "test-admin-password-that-is-long";
  const { server, origin } = await startServer({ adminPassword: password });
  const newsPath = require("node:path").join(__dirname, "..", "data", "actus.json");
  const originalNews = fs.readFileSync(newsPath, "utf8");
  let uploadedFilename;
  t.after(async () => {
    await closeServer(server);
    fs.writeFileSync(newsPath, originalNews);
    if (uploadedFilename) {
      fs.rmSync(require("node:path").join(__dirname, "..", "public", "gallery", uploadedFilename), { force: true });
    }
  });

  assert.equal((await fetch(`${origin}/admin/api/news`)).status, 401);
  const rejectedOrigin = await fetch(`${origin}/admin/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(rejectedOrigin.status, 403);

  const login = async (value) => fetch(`${origin}/admin/api/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: value })
  });
  assert.equal((await login("wrong-password")).status, 401);
  const loginResponse = await login(password);
  assert.equal(loginResponse.status, 200);
  const loginData = await loginResponse.json();
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];
  assert.match(loginResponse.headers.get("set-cookie"), /HttpOnly/);
  assert.match(loginResponse.headers.get("set-cookie"), /SameSite=Strict/);

  const newsGet = await fetch(`${origin}/admin/api/news`, { headers: { Cookie: cookie } });
  assert.equal(newsGet.status, 200);
  const newsPut = (items, csrf = loginData.csrfToken) => fetch(`${origin}/admin/api/news`, {
    method: "PUT",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ items })
  });
  assert.equal((await newsPut([],"invalid")).status, 403);

  const item = {
    id: "admin-test",
    date: "2026-10-29",
    translations: { fr: { title: "Test admin", summary: "Actualité de test." } }
  };
  assert.equal((await newsPut([item])).status, 200);
  const updatedItem = { ...item, translations: { fr: { title: "Test admin modifié", summary: "Texte édité." } } };
  assert.equal((await newsPut([updatedItem])).status, 200);
  assert.equal((await newsPut([])).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(newsPath, "utf8")).items, []);

  const content = await fetch(`${origin}/admin/api/content/fr`, { headers: { Cookie: cookie } });
  assert.equal(content.status, 200);
  const contentData = await content.json();
  const invalidContent = await fetch(`${origin}/admin/api/content/fr`, {
    method: "PUT",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": loginData.csrfToken },
    body: JSON.stringify({ content: { ...contentData.content, unexpectedKey: "no" } })
  });
  assert.equal(invalidContent.status, 400);

  const attractionsResponse = await fetch(`${origin}/admin/api/attractions`, { headers: { Cookie: cookie } });
  assert.equal(attractionsResponse.status, 200);
  const attractions = await attractionsResponse.json();
  assert.ok(attractions.names.length >= 100);
  const invalidAttractions = await fetch(`${origin}/admin/api/attractions`, {
    method: "PUT",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": loginData.csrfToken },
    body: JSON.stringify({ names: ["Attraction", "attraction"], source: "https://example.com/catalogue" })
  });
  assert.equal(invalidAttractions.status, 400);

  const image = fs.readFileSync(require("node:path").join(__dirname, "..", "public", "gallery", "image.png"));
  const uploadResponse = await fetch(`${origin}/admin/api/upload`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": loginData.csrfToken },
    body: JSON.stringify({ area: "gallery", data: image.toString("base64") })
  });
  assert.equal(uploadResponse.status, 201);
  const upload = await uploadResponse.json();
  uploadedFilename = upload.filename;
  assert.match(uploadedFilename, /^[0-9a-f-]+\.png$/);
  assert.equal((await fetch(`${origin}${upload.url}`, { method: "HEAD" })).status, 200);
  const deleteImage = await fetch(`${origin}/admin/api/gallery/${uploadedFilename}`, {
    method: "DELETE",
    headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": loginData.csrfToken }
  });
  assert.equal(deleteImage.status, 200);
  uploadedFilename = null;

  const logout = await fetch(`${origin}/admin/api/session`, {
    method: "DELETE",
    headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": loginData.csrfToken }
  });
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${origin}/admin/api/news`, { headers: { Cookie: cookie } })).status, 401);
});

test("every page is available in all three languages", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));
  const locales = ["fr", "en", "de"];
  const pages = ["", "project", "park", "progress", "team", "server", "contact"];

  for (const locale of locales) {
    for (const page of pages) {
      const response = await fetch(`${origin}/${locale}/${page}`);
      assert.equal(response.status, 200, `${locale}/${page} should be available`);
      const html = await response.text();
      assert.match(html, new RegExp(`<html lang="${locale}">`));
      assert.match(html, /<svg[^>]*class="lucide lucide-arrow-(?:up|right)/);
      assert.doesNotMatch(html, /[→↗↑]/);
    }
  }
});

test("gallery images are discovered from the gallery folder and served as images", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));
  const images = getGalleryImages();
  assert.ok(images.includes("image.png"));
  assert.ok(images.includes("image2.png"));
  assert.ok(images.includes("image3.png"));

  const response = await fetch(`${origin}/fr/park`);
  const html = await response.text();
  assert.equal((html.match(/class="gallery-image-button reveal"/g) || []).length, images.length);
  assert.match(html, /\/assets\/gallery\/image\.png/);
  assert.doesNotMatch(html, /class="gallery-placeholder/);

  const imageResponse = await fetch(`${origin}/assets/gallery/image.png`, { method: "HEAD" });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
});

test("park page lists all official catalogue entries with the unbuilt status", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));
  const catalogue = JSON.parse(fs.readFileSync(require.resolve("../data/attractions.json"), "utf8"));
  assert.equal(catalogue.names.length, 106);

  for (const [locale, status] of [["fr", "Non Construit"], ["en", "Not built"], ["de", "Nicht gebaut"]]) {
    const response = await fetch(`${origin}/${locale}/park`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Quartiers et Attractions|Themed Areas and Attractions|Themenbereiche und Attraktionen/);
    assert.equal((html.match(/class="attraction-card reveal"/g) || []).length, 106);
    assert.equal((html.match(new RegExp(`class="attraction-status">${status}</span>`, "g")) || []).length, 106);
    assert.match(html, new RegExp(catalogue.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(html, /Informations sur les zones et attractions sont à venir/);
  }
});

test("root redirects to French and unknown routes return 404", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));

  const root = await fetch(origin, { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/fr/");
  assert.equal((await fetch(`${origin}/fr/nonexistent`)).status, 404);
});

test("contact payload validation requires consent and bounded fields", () => {
  const payload = {
    discord: "epm-user",
    subject: "Question",
    message: "Bonjour, voici mon message.",
    consent: true,
    website: ""
  };
  assert.deepEqual(validateContactPayload(payload), {
    discord: "epm-user",
    subject: "Question",
    message: "Bonjour, voici mon message."
  });
  assert.equal(validateContactPayload({ ...payload, consent: false }), null);
  assert.equal(validateContactPayload({ ...payload, discord: "x" }), null);
  assert.equal(validateContactPayload({ ...payload, subject: "x" }), null);
  assert.equal(validateContactPayload({ ...payload, message: "no" }), null);
  assert.equal(validateContactPayload({ ...payload, message: "     " }), null);
  assert.equal(validateContactPayload({ ...payload, website: "spam" }), null);
});

test("webhook validation only accepts Discord webhook URLs", () => {
  assert.equal(isValidWebhook("https://discord.com/api/webhooks/123456/a_valid-token"), true);
  assert.equal(isValidWebhook("https://example.com/api/webhooks/123456/token"), false);
  assert.equal(isValidWebhook("http://discord.com/api/webhooks/123456/token"), false);
  assert.equal(isValidWebhook("https://discord.com/api/webhooks/123456/token/extra"), false);
});

test("contact endpoint forwards validated data to the private webhook", async (t) => {
  const originalFetch = global.fetch;
  const originalWebhook = process.env.DISCORD_WEBHOOK_URL;
  const webhook = "https://discord.com/api/webhooks/123456/dummy-token";
  let forwarded;
  process.env.DISCORD_WEBHOOK_URL = webhook;
  global.fetch = async (url, options) => {
    forwarded = { url, payload: JSON.parse(options.body), options };
    return { ok: true, status: 204 };
  };
  const { server, origin } = await startServer();
  t.after(async () => {
    await closeServer(server);
    global.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalWebhook;
  });

  const response = await originalFetch(`${origin}/api/contact`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      discord: "epm-user",
      subject: "Question",
      message: "Bonjour, voici mon message.",
      consent: true,
      website: ""
    })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(forwarded.url, webhook);
  assert.equal(forwarded.payload.embeds[0].fields[0].value, "epm-user");
  assert.deepEqual(forwarded.payload.allowed_mentions.parse, []);
});

test("contact endpoint rejects cross-origin submissions", async (t) => {
  const { server, origin } = await startServer();
  t.after(() => closeServer(server));

  const response = await fetch(`${origin}/api/contact`, {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 403);
});
