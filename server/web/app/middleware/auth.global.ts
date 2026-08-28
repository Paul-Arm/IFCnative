export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login") return;
  const { token } = useAuth();
  if (!token.value) {
    return navigateTo("/login");
  }
});
