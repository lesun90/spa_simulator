const path = window.location.pathname.replace(/\/+$/, "") || "/";

if (path === "/" || path === "/index.html") {
  window.location.replace(`/scene_studio${window.location.search}${window.location.hash}`);
} else if (path === "/scene_studio") {
  document.title = "Scene Studio · Steerlab";
  void import("./scene-studio/main");
} else if (path === "/scenario_studio") {
  document.title = "Scenario Studio · Steerlab";
  void import("./scenario-studio/main");
} else {
  document.title = "Page not found · Steerlab";
  document.body.textContent = "Page not found";
}
