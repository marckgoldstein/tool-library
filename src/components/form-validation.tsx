"use client";

import { useEffect } from "react";

/**
 * Keeps aria-invalid and aria-describedby in step with the browser's :user-invalid
 * state, so screen readers hear an error only once sighted users see it
 * (Modern Web Guidance: accessible-error-announcement, required-field-feedback).
 *
 * Fields opt in with data-error="<id of the error message>". Error messages are
 * shown by CSS (`:user-invalid ~ .error-msg`), not by this script.
 * Render once per page that has a form.
 */
export function FormValidation() {
  useEffect(() => {
    const supported = CSS.supports("selector(:user-invalid)");
    const announcer = document.createElement("div");
    announcer.setAttribute("aria-live", "polite");
    announcer.className = "visually-hidden";
    document.body.append(announcer);
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    let announcedField: Element | null = null;
    const flagged = new WeakSet<Element>();
    const announced = new WeakSet<Element>();
    const touched = new WeakSet<Element>(); // fallback interaction tracking

    const isField = (el: EventTarget | null): el is HTMLInputElement =>
      el instanceof HTMLElement && el.matches("input, select, textarea");

    const linkError = (el: HTMLElement, shown: boolean) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    };

    const spokenText = (node: Element) => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    };

    const announceError = (el: HTMLInputElement) => {
      const error = el.dataset.error ? document.getElementById(el.dataset.error) : null;
      if (!error) return;
      const label = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : "";
      clearTimeout(announceTimer);
      announcer.textContent = "";
      announcedField = el;
      announceTimer = setTimeout(() => {
        announcer.textContent = label + spokenText(error);
      }, 500);
    };

    const userInvalid = (el: HTMLInputElement) =>
      supported ? el.matches(":user-invalid") : touched.has(el) && !el.validity.valid;

    const sync = (el: HTMLInputElement, announce = false) => {
      const invalid = userInvalid(el);
      if (!supported) el.classList.toggle("user-invalid-fallback", invalid);
      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute("aria-invalid", "true");
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
        el.setAttribute("aria-invalid", "false");
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = "";
        }
      }
    };

    document.querySelectorAll<HTMLInputElement>("form input, form select, form textarea").forEach((el) => sync(el));

    const onBlur = (e: Event) => {
      if (!isField(e.target)) return;
      if (!supported && e.target.value) touched.add(e.target);
      sync(e.target, true);
    };
    const onInput = (e: Event) => {
      if (isField(e.target) && e.target.hasAttribute("aria-invalid")) sync(e.target);
    };
    const onChange = (e: Event) => {
      if (!isField(e.target)) return;
      if (!supported) touched.add(e.target);
      sync(e.target, true);
    };
    const onInvalid = (e: Event) => {
      if (!isField(e.target)) return;
      touched.add(e.target);
      announced.add(e.target);
      sync(e.target);
    };

    document.addEventListener("blur", onBlur, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange, true);
    document.addEventListener("invalid", onInvalid, true);
    return () => {
      clearTimeout(announceTimer);
      announcer.remove();
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("input", onInput);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("invalid", onInvalid, true);
    };
  }, []);
  return null;
}
