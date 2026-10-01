export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login" || to.path === "/embed") return;
  const { token } = useAuth();
  const { embed } = useEmbed();
  if (!token.value) {
    // Eingebettet gibt es kein Hub-Login — neu anmelden geht nur über
    // OpenProject (neues Ticket).
    if (embed.value) return navigateTo("/embed");
    // Nach der Anmeldung zurück zur ursprünglich aufgerufenen Seite.
    return navigateTo(to.fullPath === "/" ? "/login" : { path: "/login", query: { next: to.fullPath } });
  }
  // Eingebettet bleibt man im Projekt, das OpenProject vorgibt.
  if (embed.value && to.path === "/") {
    return navigateTo(`/p/${embed.value.projectSlug}`);
  }
});
