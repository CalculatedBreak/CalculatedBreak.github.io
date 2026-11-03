(() => {
  const storageKey = "edusphere-theme";
  const validThemes = ["light", "dark"];
  const root = document.documentElement;

  function applyTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const nextTheme = theme === "dark" ? "light" : "dark";
      button.textContent = nextTheme === "dark" ? "Dark mode" : "Light mode";
      button.setAttribute("aria-label", "Switch to " + nextTheme + " mode");
      button.setAttribute("aria-pressed", String(theme === "dark"));
    });
  }

  let savedTheme = "light";
  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    if (validThemes.includes(storedTheme)) savedTheme = storedTheme;
  } catch (error) {
    console.warn("Could not read the saved theme preference:", error);
  }
  applyTheme(savedTheme);

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = root.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(theme);
        try {
          window.localStorage.setItem(storageKey, theme);
        } catch (error) {
          console.warn("Could not save the theme preference:", error);
        }
      });
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key === storageKey && validThemes.includes(event.newValue)) {
      applyTheme(event.newValue);
    }
  });
})();
