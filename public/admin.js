"use strict";

const loginPanel = document.querySelector("#admin-login-panel");
const unconfiguredPanel = document.querySelector("#admin-unconfigured");
const adminApp = document.querySelector("#admin-app");
const notice = document.querySelector("#admin-notice");
const logoutButton = document.querySelector("#admin-logout");
let csrfToken = "";
let newsItems = [];

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("is-error", isError);
  notice.classList.toggle("is-visible", Boolean(message));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error("Réponse inattendue du serveur.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      if (path !== "/admin/api/session") showLogin();
      throw new Error("Session expirée. Veuillez vous reconnecter.");
    }
    if (result.error === "admin_not_configured") unconfiguredPanel.hidden = false;
    throw new Error(result.message || ({
      invalid_credentials: "Mot de passe incorrect.",
      rate_limited: "Trop de tentatives. Réessayez dans quelques minutes.",
      csrf_invalid: "La session a expiré. Reconnectez-vous.",
      invalid_image: "Image invalide ou supérieure à 4 Mo.",
      invalid_content_shape: "Le JSON ne respecte pas la structure attendue."
    })[result.error] || "L’opération a échoué.");
  }
  return result;
}

function showLogin() {
  loginPanel.hidden = false;
  adminApp.hidden = true;
  logoutButton.hidden = true;
  unconfiguredPanel.hidden = true;
  csrfToken = "";
  api("/admin/api/session").then((result) => {
    csrfToken = result.csrfToken;
    loginPanel.hidden = true;
    unconfiguredPanel.hidden = true;
    adminApp.hidden = false;
    logoutButton.hidden = false;
    loadNews();
    loadGallery();
    loadAttractions();
    loadContent();
  }).catch((error) => {
    if (!error.message.includes("Session expirée")) showNotice("");
  });
}

function getNewsFormTranslation(locale) {
  const read = (field) => document.querySelector(`[data-locale="${locale}"][data-field="${field}"]`).value.trim();
  const title = read("title");
  const summary = read("summary");
  const category = read("category");
  const body = read("body").split(/\r?\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (locale !== "fr" && !title && !summary && !category && body.length === 0) return null;
  return { ...(category ? { category } : {}), title, summary, ...(body.length ? { body } : {}) };
}

async function loadNews() {
  const result = await api("/admin/api/news");
  newsItems = result.items;
  const list = document.querySelector("#news-list");
  list.replaceChildren();
  if (!newsItems.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Aucune actualité publiée.";
    list.append(empty);
    return;
  }
  for (const item of newsItems) {
    const row = document.createElement("article");
    row.className = "admin-list-item";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.translations.fr.title;
    const details = document.createElement("p");
    details.textContent = `${item.date} · ${item.id}`;
    info.append(title, details);
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const edit = document.createElement("button");
    edit.className = "admin-button";
    edit.type = "button";
    edit.textContent = "Modifier";
    edit.addEventListener("click", () => editNews(item));
    const remove = document.createElement("button");
    remove.className = "admin-button admin-danger";
    remove.type = "button";
    remove.textContent = "Supprimer";
    remove.addEventListener("click", () => deleteNews(item));
    actions.append(edit, remove);
    row.append(info, actions);
    list.append(row);
  }
}

function editNews(item) {
  document.querySelector("#news-editor").hidden = false;
  document.querySelector("#news-editor-title").textContent = "Modifier l’actualité";
  document.querySelector("#news-id").value = item.id;
  document.querySelector("#news-slug").value = item.id;
  document.querySelector("#news-slug").readOnly = true;
  document.querySelector("#news-date").value = item.date;
  document.querySelector("#news-image").value = item.image || "";
  document.querySelector("#news-image-file").value = "";
  for (const locale of ["fr", "en", "de"]) {
    const translation = item.translations[locale] || {};
    for (const field of ["category", "title", "summary"]) {
      document.querySelector(`[data-locale="${locale}"][data-field="${field}"]`).value = translation[field] || "";
    }
    document.querySelector(`[data-locale="${locale}"][data-field="body"]`).value = (translation.body || []).join("\n");
  }
  document.querySelector("#news-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveNews(event) {
  event.preventDefault();
  const originalId = document.querySelector("#news-id").value;
  const item = {
    id: originalId || document.querySelector("#news-slug").value.trim(),
    date: document.querySelector("#news-date").value,
    translations: { fr: getNewsFormTranslation("fr") }
  };
  if (document.querySelector("#news-image").value) item.image = document.querySelector("#news-image").value;
  for (const locale of ["en", "de"]) {
    const translation = getNewsFormTranslation(locale);
    if (translation) item.translations[locale] = translation;
  }
  const next = originalId
    ? newsItems.map((existing) => existing.id === originalId ? item : existing)
    : [...newsItems, item];
  const result = await api("/admin/api/news", { method: "PUT", body: JSON.stringify({ items: next }) });
  newsItems = result.items;
  document.querySelector("#news-form").reset();
  document.querySelector("#news-id").value = "";
  document.querySelector("#news-slug").readOnly = false;
  document.querySelector("#news-editor").hidden = true;
  await loadNews();
  showNotice("Actualité enregistrée.");
}

async function deleteNews(item) {
  if (!window.confirm(`Supprimer « ${item.translations.fr.title} » ?`)) return;
  const result = await api("/admin/api/news", {
    method: "PUT",
    body: JSON.stringify({ items: newsItems.filter((existing) => existing.id !== item.id) })
  });
  newsItems = result.items;
  await loadNews();
  showNotice("Actualité supprimée.");
}

async function uploadImage(file, area) {
  if (!file) return null;
  if (file.size > 4 * 1024 * 1024) throw new Error("Chaque image doit faire 4 Mo maximum.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const result = await api("/admin/api/upload", {
    method: "POST",
    body: JSON.stringify({ area, data: btoa(binary) })
  });
  return result;
}

async function loadGallery() {
  const result = await api("/admin/api/gallery");
  const grid = document.querySelector("#gallery-grid");
  grid.replaceChildren();
  if (!result.images.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Aucune image dans la galerie.";
    grid.append(empty);
    return;
  }
  for (const filename of result.images) {
    const card = document.createElement("article");
    card.className = "admin-gallery-item";
    const image = document.createElement("img");
    image.src = `/assets/gallery/${encodeURIComponent(filename)}`;
    image.alt = "";
    image.loading = "lazy";
    const footer = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = filename;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-button admin-danger";
    remove.textContent = "Supprimer";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Supprimer l’image « ${filename} » ?`)) return;
      await api(`/admin/api/gallery/${encodeURIComponent(filename)}`, { method: "DELETE" });
      await loadGallery();
      showNotice("Image supprimée de la galerie.");
    });
    footer.append(name, remove);
    card.append(image, footer);
    grid.append(card);
  }
}

async function loadContent() {
  const locale = document.querySelector("#content-locale").value;
  const result = await api(`/admin/api/content/${locale}`);
  document.querySelector("#content-json").value = `${JSON.stringify(result.content, null, 2)}\n`;
}

async function loadAttractions() {
  const namesField = document.querySelector("#attractions-names");
  const sourceField = document.querySelector("#attractions-source");
  if (!namesField || !sourceField) return;
  const result = await api("/admin/api/attractions");
  namesField.value = `${result.names.join("\n")}\n`;
  sourceField.value = result.source;
}

document.querySelector("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const password = document.querySelector("#admin-password").value;
    const result = await api("/admin/api/login", { method: "POST", body: JSON.stringify({ password }) });
    csrfToken = result.csrfToken;
    document.querySelector("#admin-password").value = "";
    loginPanel.hidden = true;
    unconfiguredPanel.hidden = true;
    adminApp.hidden = false;
    logoutButton.hidden = false;
    await Promise.all([loadNews(), loadGallery(), loadAttractions(), loadContent()]);
    showNotice("Connexion réussie.");
  } catch (error) {
    if (error.message.includes("ADMIN_PASSWORD")) unconfiguredPanel.hidden = false;
    showNotice(error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/admin/api/session", { method: "DELETE" });
    showLogin();
    showNotice("Déconnexion effectuée.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelector("#news-new").addEventListener("click", () => {
  document.querySelector("#news-form").reset();
  document.querySelector("#news-id").value = "";
  document.querySelector("#news-slug").readOnly = false;
  document.querySelector("#news-date").value = new Date().toISOString().slice(0, 10);
  document.querySelector("#news-editor-title").textContent = "Nouvelle actualité";
  document.querySelector("#news-editor").hidden = false;
  document.querySelector("#news-editor").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#news-cancel").addEventListener("click", () => {
  document.querySelector("#news-editor").hidden = true;
});
document.querySelector("#news-form").addEventListener("submit", (event) => {
  saveNews(event).catch((error) => showNotice(error.message, true));
});
document.querySelector("#news-image-upload").addEventListener("click", async () => {
  try {
    const result = await uploadImage(document.querySelector("#news-image-file").files[0], "news");
    if (result) {
      document.querySelector("#news-image").value = result.filename;
      showNotice("Couverture importée.");
    }
  } catch (error) {
    showNotice(error.message, true);
  }
});
document.querySelector("#gallery-upload").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  try {
    for (const file of files) await uploadImage(file, "gallery");
    await loadGallery();
    showNotice(`${files.length} image(s) importée(s).`);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#content-locale").addEventListener("change", () => {
  loadContent().catch((error) => showNotice(error.message, true));
});
document.querySelector("#content-save").addEventListener("click", async () => {
  try {
    const content = JSON.parse(document.querySelector("#content-json").value);
    const locale = document.querySelector("#content-locale").value;
    await api(`/admin/api/content/${locale}`, { method: "PUT", body: JSON.stringify({ content }) });
    showNotice("Textes du site enregistrés.");
  } catch (error) {
    showNotice(error instanceof SyntaxError ? "JSON invalide : vérifiez la syntaxe." : error.message, true);
  }
});
const attractionsSaveButton = document.querySelector("#attractions-save");
if (attractionsSaveButton) {
  attractionsSaveButton.addEventListener("click", async () => {
    const names = document.querySelector("#attractions-names").value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    const source = document.querySelector("#attractions-source").value.trim();
    try {
      await api("/admin/api/attractions", { method: "PUT", body: JSON.stringify({ names, source }) });
      showNotice("Catalogue enregistré.");
    } catch (error) {
      showNotice(error.message, true);
    }
  });
}
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab === button)));
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
  });
});

showLogin();
