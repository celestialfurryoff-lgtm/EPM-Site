"use strict";

const menuButton = document.querySelector(".menu-toggle");
const primaryNavigation = document.querySelector(".primary-navigation");

if (menuButton && primaryNavigation) {
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    document.body.classList.toggle("navigation-open", !expanded);
  });
  primaryNavigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      menuButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("navigation-open");
    }
  });
}

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const contactForm = document.querySelector("#contact-form");
if (contactForm) {
  const feedback = document.querySelector("#form-feedback");
  const submitButton = contactForm.querySelector('button[type="submit"]');
  const buttonLabel = submitButton.querySelector("span");
  const errorMessages = {
    not_configured: contactForm.dataset.errorNotConfigured,
    invalid_fields: contactForm.dataset.errorInvalid,
    rate_limited: contactForm.dataset.errorRateLimit,
    delivery_failed: contactForm.dataset.errorUpstream
  };
  ["discord", "subject", "message"].forEach((name) => {
    const field = contactForm.elements.namedItem(name);
    field.addEventListener("input", () => {
      field.setCustomValidity(field.value.trim().length < Number(field.minLength) ? contactForm.dataset.errorInvalid : "");
    });
  });

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.classList.remove("is-error", "is-success");

    const formData = new FormData(contactForm);
    const payload = {
      discord: formData.get("discord"),
      subject: formData.get("subject"),
      message: formData.get("message"),
      consent: formData.get("consent") === "on",
      website: formData.get("website")
    };
    const requiredTextFields = ["discord", "subject", "message"];
    const invalidField = requiredTextFields
      .map((name) => contactForm.elements.namedItem(name))
      .find((field) => field.value.trim().length < Number(field.minLength));
    if (invalidField) {
      invalidField.setCustomValidity(contactForm.dataset.errorInvalid);
      invalidField.reportValidity();
      feedback.textContent = contactForm.dataset.errorInvalid;
      feedback.classList.add("is-error");
      return;
    }
    requiredTextFields.forEach((name) => contactForm.elements.namedItem(name).setCustomValidity(""));

    submitButton.disabled = true;
    buttonLabel.textContent = contactForm.dataset.sendingLabel;

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        feedback.textContent = errorMessages[result.error] || contactForm.dataset.errorGeneric;
        feedback.classList.add("is-error");
        return;
      }
      contactForm.reset();
      feedback.textContent = contactForm.dataset.successMessage;
      feedback.classList.add("is-success");
    } catch {
      feedback.textContent = contactForm.dataset.errorGeneric;
      feedback.classList.add("is-error");
    } finally {
      submitButton.disabled = false;
      buttonLabel.textContent = contactForm.dataset.submitLabel;
    }
  });
}

const galleryButtons = document.querySelectorAll("[data-gallery-image]");
if (galleryButtons.length && typeof HTMLDialogElement !== "undefined") {
  const dialog = document.createElement("dialog");
  dialog.className = "gallery-dialog";
  dialog.setAttribute("aria-label", document.documentElement.lang === "fr" ? "Agrandissement de l’image" : document.documentElement.lang === "de" ? "Bild vergrößern" : "Image preview");
  const closeButton = document.createElement("button");
  closeButton.className = "gallery-dialog-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", document.documentElement.lang === "fr" ? "Fermer" : document.documentElement.lang === "de" ? "Schließen" : "Close");
  closeButton.textContent = "×";
  const image = document.createElement("img");
  image.alt = "";
  dialog.append(closeButton, image);
  document.body.append(dialog);

  const closeDialog = () => dialog.close();
  closeButton.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  galleryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      image.src = button.dataset.galleryImage;
      image.alt = button.dataset.galleryAlt;
      dialog.showModal();
      closeButton.focus();
    });
  });
}
