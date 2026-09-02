<template>
  <!-- Fortschrittsbalken oben während Seitenwechseln: sofortiges Feedback,
       auch wenn die Zielseite noch auf Daten wartet. -->
  <NuxtLoadingIndicator color="var(--accent)" :height="3" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
