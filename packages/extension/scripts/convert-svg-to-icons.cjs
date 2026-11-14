import("../../../scripts/generate-brand-assets.mjs").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
