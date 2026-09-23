export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login") return;
  const { token } = useAuth();
  if (!token.value) {
    // Nach der Anmeldung zurück zur ursprünglich aufgerufenen Seite.
    return navigateTo(to.fullPath === "/" ? "/login" : { path: "/login", query: { next: to.fullPath } });
  }
});
