// Sections slide in as they reach the screen, and the hero's run plays once its card is in view.
const onSight = (elements, name, options) => {
  if (!("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add(name));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add(name);
        observer.unobserve(entry.target);
      }
    }
  }, options);
  elements.forEach((element) => observer.observe(element));
};
onSight(document.querySelectorAll(".reveal"), "shown", { rootMargin: "0px 0px -8% 0px" });
onSight(document.querySelectorAll(".run-card"), "started", { threshold: 0.3 });

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
      button.classList.add("done");
    } catch {
      button.textContent = "Press ⌘C";
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("done");
    }, 2000);
  });
});

// Each group of tab buttons shows one panel and hides the others it controls; the panel it opens settles into place.
const still = matchMedia("(prefers-reduced-motion: reduce)");
document.querySelectorAll("[data-tabs]").forEach((group) => {
  const buttons = group.querySelectorAll("[data-tab]");
  const show = (id) => buttons.forEach((button) => {
    const on = button.dataset.tab === id;
    const panel = document.getElementById(button.dataset.tab);
    const opening = on && !panel.classList.contains("active");
    button.setAttribute("aria-pressed", String(on));
    panel.classList.toggle("active", on);
    if (opening && !still.matches) {
      panel.animate([{ transform: "translateY(10px)" }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
  });
  buttons.forEach((button) => button.addEventListener("click", () => show(button.dataset.tab)));
});

// A code block that scrolls sideways takes keyboard focus, so it can be scrolled without a mouse; one that fits does not.
if ("ResizeObserver" in window) {
  const scrollers = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target.scrollWidth > target.clientWidth) target.tabIndex = 0;
      else target.removeAttribute("tabindex");
    }
  });
  document.querySelectorAll(".code pre").forEach((pre) => scrollers.observe(pre));
}
